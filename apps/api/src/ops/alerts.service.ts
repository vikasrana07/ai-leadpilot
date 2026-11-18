import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { MailService } from '../mail/mail.module.js';
import { metrics } from '../observability/metrics.js';
import { ALERT_RULES, RULES_BY_KEY, THRESHOLDS, alertEmail, evaluateRules, pickRecipients, type AlertInput, type RuleValues } from './alert-rules.js';
import { HealthSnapshotService, type OpsSnapshot } from './health-snapshot.service.js';
import { WorkerHeartbeat } from './worker-heartbeat.js';

/** Minimum time between two emails about the same alert (damping against flapping). A suppressed email is retried on the next evaluation. */
export const EMAIL_DAMPING_MINUTES = 15;
const LOCK_SECONDS = 50;
const EVERY_MS = 60_000;

interface AlertRow {
  key: string; severity: number; status: 'firing' | 'resolved'; title: string; streak_failing: number; streak_ok: number;
  since: Date | null; resolved_at: Date | null; last_notified_at: Date | null; notify_count: number; resolve_notify_due: boolean; last_value: RuleValues;
}
export interface Transition { key: string; to: 'firing' | 'resolved' }
export interface EvaluationReport { evaluated: number; unknown: number; transitions: Transition[]; emails: number; skipped?: string }

export interface AlertDto { key: string; title: string; severity: number; status: 'firing' | 'resolved'; since: string | null; resolvedAt: string | null; lastNotifiedAt: string | null; notifyCount: number; values: RuleValues; hint: string; runbook: string }

/** The SLOs of docs/slos-and-alerts.md with what the app can show today. */
export const SLO_TABLE: readonly { id: number; name: string; objective: string; source: 'snapshot' | 'metrics' | 'external' }[] = [
  { id: 1, name: 'Availability (GET /health/ready)', objective: '99.5% monthly', source: 'external' },
  { id: 2, name: 'Dashboard load (/analytics/*)', objective: 'p95 under 2 s', source: 'metrics' },
  { id: 3, name: 'WhatsApp webhook ACK', objective: 'p95 under 1 s', source: 'metrics' },
  { id: 4, name: 'AI turn latency (last 24 h)', objective: 'p95 under 8 s', source: 'snapshot' },
  { id: 5, name: 'Outbox lag (oldest pending event)', objective: 'under 60 s', source: 'snapshot' },
  { id: 6, name: 'Automation runs not stuck', objective: 'none stuck', source: 'snapshot' },
  { id: 7, name: 'Billing webhook health', objective: '0 failed or unprocessed older than 15 min', source: 'snapshot' },
  { id: 8, name: 'Server errors (5xx)', objective: 'under 0.5% of requests', source: 'metrics' },
];

const toDto = (r: AlertRow): AlertDto => {
  const rule = RULES_BY_KEY.get(r.key);
  return { key: r.key, title: r.title, severity: r.severity, status: r.status, since: r.since?.toISOString() ?? null, resolvedAt: r.resolved_at?.toISOString() ?? null, lastNotifiedAt: r.last_notified_at?.toISOString() ?? null, notifyCount: r.notify_count, values: r.last_value ?? {}, hint: rule?.hint ?? '', runbook: rule?.runbook ?? '' };
};

/**
 * Turns the health snapshot into alerts and emails (monitoring milestone 3). Once a minute, from whichever process wins a short Redis lock
 * (the worker's maintenance job, or an API process, so a dead worker is still noticed): rules are evaluated, "breached for N in a row"
 * becomes firing, "fine for 2 in a row" becomes resolved, and a state change or a repeat sends one email per recipient. Every state
 * change is a compare-and-set in the database, so two evaluators racing (or a lock that failed) cannot send the same email twice.
 */
@Injectable()
export class AlertsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Alerts');
  private timer: NodeJS.Timeout | null = null;
  private warnedNoRecipients = false;

  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env, @Inject(MailService) private readonly mail: MailService,
    @Inject(HealthSnapshotService) private readonly snapshots: HealthSnapshotService, @Inject(WorkerHeartbeat) private readonly heartbeat: WorkerHeartbeat,
  ) {}

  get enabled(): boolean { return this.env.ALERTS_ENABLED; }

  /** An API (or worker) process evaluates alerts on its own timer too: when the worker is dead nobody else would notice. */
  onApplicationBootstrap(): void {
    if (!this.enabled || this.timer || this.env.NODE_ENV === 'test') return; // tests drive evaluate() directly
    this.timer = setInterval(() => { void this.runLocked(); }, EVERY_MS);
    this.timer.unref();
  }
  onApplicationShutdown(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Evaluates at most once a minute across all processes (Redis lock; if Redis is down the database compare-and-set still prevents duplicates). */
  async runLocked(now: Date = new Date()): Promise<EvaluationReport | null> {
    if (!this.enabled) return null;
    try {
      const r = this.heartbeat.client();
      if (r.status === 'wait' || r.status === 'end') await r.connect();
      const got = await r.set(`${this.env.QUEUE_PREFIX}:ops:alerts:lock`, '1', 'EX', LOCK_SECONDS, 'NX');
      if (got !== 'OK') return null;
    } catch { /* no Redis: evaluate anyway */ }
    try { return await this.evaluate(now); } catch (e) { this.log.error(`alert evaluation failed: ${e instanceof Error ? e.message : String(e)}`); return null; }
  }

  /** Builds the rule input from the latest snapshot and the live worker heartbeats. */
  async buildInput(now: Date): Promise<AlertInput> {
    const snapshot = await this.snapshots.readLatest();
    const beats = await this.heartbeat.listOrNull();
    const age = snapshot ? Math.max(0, Math.round((now.getTime() - new Date(snapshot.generatedAt).getTime()) / 1000)) : null;
    return { snapshot, snapshotAgeSeconds: age, workersAlive: beats === null ? null : beats.length };
  }

  async evaluate(now: Date = new Date(), opts: { input?: AlertInput; force?: boolean } = {}): Promise<EvaluationReport> {
    if (!this.enabled && !opts.force) return { evaluated: 0, unknown: 0, transitions: [], emails: 0, skipped: 'alerts disabled' };
    const input = opts.input ?? (await this.buildInput(now));
    const transitions: Transition[] = [];
    let unknown = 0;
    for (const { rule, result } of evaluateRules(input)) {
      if (result.breached === null) { unknown++; continue; }
      const values = JSON.stringify(result.values);
      if (result.breached) {
        const rows = await this.db.prisma.$queryRaw<AlertRow[]>`
          INSERT INTO ops_alerts (key, severity, title, streak_failing, last_value) VALUES (${rule.key}, ${rule.severity}, ${rule.title}, 1, ${values}::jsonb)
          ON CONFLICT (key) DO UPDATE SET streak_failing = ops_alerts.streak_failing + 1, streak_ok = 0, severity = EXCLUDED.severity, title = EXCLUDED.title, last_value = EXCLUDED.last_value, updated_at = now()
          RETURNING *`;
        if (rows[0] && rows[0].status === 'resolved' && rows[0].streak_failing >= rule.forMinutes) {
          const fired = await this.db.prisma.$queryRaw<AlertRow[]>`
            UPDATE ops_alerts SET status = 'firing', since = ${now}, resolved_at = NULL, notify_count = 0, resolve_notify_due = false, updated_at = now()
            WHERE key = ${rule.key} AND status = 'resolved' AND streak_failing >= ${rule.forMinutes} RETURNING *`;
          if (fired[0]) { transitions.push({ key: rule.key, to: 'firing' }); this.log.error(`alert firing key=${rule.key} severity=${rule.severity} values=${values}`); }
        }
      } else {
        const rows = await this.db.prisma.$queryRaw<AlertRow[]>`
          UPDATE ops_alerts SET streak_ok = streak_ok + 1, streak_failing = 0, last_value = ${values}::jsonb, updated_at = now() WHERE key = ${rule.key} RETURNING *`;
        if (rows[0] && rows[0].status === 'firing' && rows[0].streak_ok >= THRESHOLDS.resolveAfterOk) {
          const done = await this.db.prisma.$queryRaw<AlertRow[]>`
            UPDATE ops_alerts SET status = 'resolved', resolved_at = ${now}, resolve_notify_due = (notify_count > 0), updated_at = now()
            WHERE key = ${rule.key} AND status = 'firing' AND streak_ok >= ${THRESHOLDS.resolveAfterOk} RETURNING *`;
          if (done[0]) { transitions.push({ key: rule.key, to: 'resolved' }); this.log.log(`alert resolved key=${rule.key} severity=${rule.severity}`); }
        }
      }
    }
    const emails = await this.notify(now);
    await this.publishGauges();
    return { evaluated: ALERT_RULES.length - unknown, unknown, transitions, emails };
  }

  // ------------------------------------------------------------------ email
  private async recipients(): Promise<string[]> {
    const admins = await this.db.prisma.platformAdmin.findMany({ where: { status: 'ACTIVE' }, select: { email: true } });
    return pickRecipients(this.env.ALERT_EMAIL_TO, admins.map((a) => a.email));
  }

  /** Sends what is due: first email of a firing alert, repeats of Sev 1-2, and "resolved". Each is claimed in the database before it is sent. */
  private async notify(now: Date): Promise<number> {
    const rows = await this.db.prisma.$queryRaw<AlertRow[]>`SELECT * FROM ops_alerts WHERE status = 'firing' OR resolve_notify_due`;
    if (rows.length === 0) return 0;
    const to = await this.recipients();
    if (to.length === 0) {
      if (!this.warnedNoRecipients) { this.warnedNoRecipients = true; this.log.warn('Alerts are firing but there is no recipient (set ALERT_EMAIL_TO or create a platform admin)'); }
      return 0;
    }
    this.warnedNoRecipients = false;
    const damp = `${EMAIL_DAMPING_MINUTES} minutes`;
    const repeat = `${this.env.ALERT_REPEAT_HOURS * 60} minutes`;
    let sent = 0;
    for (const r of rows) {
      const rule = RULES_BY_KEY.get(r.key);
      if (!rule) continue;
      let kind: 'firing' | 'repeat' | 'resolved' | null = null;
      let claimed: AlertRow[] = [];
      if (r.status === 'firing' && r.notify_count === 0) {
        kind = 'firing';
        claimed = await this.db.prisma.$queryRaw<AlertRow[]>`UPDATE ops_alerts SET last_notified_at = ${now}, notify_count = notify_count + 1 WHERE key = ${r.key} AND status = 'firing' AND notify_count = 0 AND (last_notified_at IS NULL OR last_notified_at < ${now}::timestamptz - ${damp}::interval) RETURNING *`;
      } else if (r.status === 'firing' && r.severity <= 2) {
        kind = 'repeat';
        claimed = await this.db.prisma.$queryRaw<AlertRow[]>`UPDATE ops_alerts SET last_notified_at = ${now}, notify_count = notify_count + 1 WHERE key = ${r.key} AND status = 'firing' AND notify_count = ${r.notify_count} AND last_notified_at < ${now}::timestamptz - ${repeat}::interval RETURNING *`;
      } else if (r.status === 'resolved' && r.resolve_notify_due) {
        kind = 'resolved';
        claimed = await this.db.prisma.$queryRaw<AlertRow[]>`UPDATE ops_alerts SET last_notified_at = ${now}, notify_count = notify_count + 1, resolve_notify_due = false WHERE key = ${r.key} AND status = 'resolved' AND resolve_notify_due AND (last_notified_at IS NULL OR last_notified_at < ${now}::timestamptz - ${damp}::interval) RETURNING *`;
      }
      const c = claimed[0];
      if (!kind || !c) continue;
      const { subject, text } = alertEmail(kind, { rule, since: c.since, resolvedAt: c.resolved_at, values: c.last_value ?? {}, webOrigin: this.env.WEB_ORIGIN });
      for (const addr of to) {
        try { await this.mail.sendAlert(addr, subject, text); sent++; } catch (e) { this.log.error(`alert email failed: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    return sent;
  }

  private async publishGauges(): Promise<void> {
    const rows = await this.db.prisma.$queryRaw<{ severity: number; n: number }[]>`SELECT severity, count(*)::int AS n FROM ops_alerts WHERE status = 'firing' GROUP BY severity`;
    const by = (s: number): number => rows.find((r) => r.severity === s)?.n ?? 0;
    metrics.gauge('AlertsFiring', by(1) + by(2) + by(3)); metrics.gauge('AlertsFiringSev1', by(1)); metrics.gauge('AlertsFiringSev2', by(2)); metrics.gauge('AlertsFiringSev3', by(3));
  }

  // ------------------------------------------------------------------ Ops Status page
  /** Everything the platform console's Ops page shows: live rule state, stored alerts, the snapshot, queues, workers and the SLO table. */
  async view(now: Date = new Date()) {
    const input = await this.buildInput(now);
    const snap: OpsSnapshot | null = input.snapshot;
    const age = input.snapshotAgeSeconds;
    const stale = snap === null || age === null || age > THRESHOLDS.snapshotStaleSeconds;
    const rows = await this.db.prisma.$queryRaw<AlertRow[]>`SELECT * FROM ops_alerts ORDER BY severity, key`;
    const firing = rows.filter((r) => r.status === 'firing').map(toDto);
    const recent = rows.filter((r) => r.status === 'resolved' && r.resolved_at).sort((a, b) => (b.resolved_at as Date).getTime() - (a.resolved_at as Date).getTime()).slice(0, 20).map(toDto);
    const rules = evaluateRules(input).map(({ rule, result }) => ({ key: rule.key, title: rule.title, severity: rule.severity, forMinutes: rule.forMinutes, state: result.breached === null ? 'unknown' : result.breached ? 'breached' : 'ok', values: result.values }));
    const db = snap?.db ?? null;
    const slos = SLO_TABLE.map((s) => ({ ...s, current: this.sloCurrent(s.id, db) }));
    const instances = (snap?.workers.instances ?? []).map((w) => ({ instanceId: w.instanceId, startedAt: w.startedAt, lastBeat: w.lastBeat, version: w.version, ageSeconds: Math.max(0, Math.round((now.getTime() - new Date(w.lastBeat).getTime()) / 1000)) }));
    return {
      now: now.toISOString(), alertsEnabled: this.enabled,
      snapshot: { generatedAt: snap?.generatedAt ?? null, ageSeconds: age, stale },
      firing, recent, rules, health: db, queues: snap?.queues ?? null,
      workers: { alive: input.workersAlive, instances },
      slos,
    };
  }

  private sloCurrent(id: number, db: OpsSnapshot['db'] | null): { value: string; ok: boolean | null } | null {
    if (!db) return null;
    const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    switch (id) {
      case 4: return db.ai.p95_latency_ms_24h === null ? null : { value: `${(n(db.ai.p95_latency_ms_24h) / 1000).toFixed(1)} s`, ok: n(db.ai.p95_latency_ms_24h) < 8000 };
      case 5: return { value: `${Math.round(n(db.outbox.oldest_pending_seconds))} s`, ok: n(db.outbox.oldest_pending_seconds) < 60 };
      case 6: return { value: `${n(db.automation_runs.stuck_running) + n(db.automation_runs.queued_old)} stuck`, ok: n(db.automation_runs.stuck_running) + n(db.automation_runs.queued_old) === 0 };
      case 7: return { value: `${n(db.billing_events_needing_attention)} needing attention`, ok: n(db.billing_events_needing_attention) === 0 };
      default: return null;
    }
  }
}
