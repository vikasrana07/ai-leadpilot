import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { metrics } from '../observability/metrics.js';
import { WorkerHeartbeat, type Heartbeat } from './worker-heartbeat.js';

export const SNAPSHOT_TTL_SECONDS = 300;
export const snapshotKey = (prefix: string): string => `${prefix}:ops:snapshot`;

/** What ops_health_snapshot() returns (counts and ages only, no tenant data). */
export interface DbSnapshot {
  generated_at: string;
  outbox: { pending: number; oldest_pending_seconds: number; failed: number };
  automation_runs: { stuck_running: number; queued_old: number; waiting_overdue: number; failed_last_hour: number };
  billing_events_needing_attention: number;
  webhook_events_unprocessed: number;
  outbound_messages_failed_last_hour: number;
  webhook_deliveries: { overdue: number; failed_last_hour: number };
  webhook_endpoints_disabled: number;
  ai: { runs_last_15_min: number; failed_last_15_min: number; p95_latency_ms_24h: number | null };
}
export interface QueueCounts { waiting: number; active: number; delayed: number; failed: number }
export interface OpsSnapshot {
  generatedAt: string;
  db: DbSnapshot;
  queues: QueueCounts | null;
  workers: { alive: number; newestBeatAgeSeconds: number | null; instances: Heartbeat[] };
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Maps a snapshot onto the gauge names in observability/metrics.ts. */
export function publishGauges(s: OpsSnapshot): void {
  const g = (name: string, v: number | null | undefined): void => metrics.gauge(name, v);
  g('OutboxPending', n(s.db.outbox.pending)); g('OutboxOldestPendingSeconds', n(s.db.outbox.oldest_pending_seconds)); g('OutboxFailed', n(s.db.outbox.failed));
  g('RunsStuckRunning', n(s.db.automation_runs.stuck_running)); g('RunsQueuedOld', n(s.db.automation_runs.queued_old));
  g('RunsWaitingOverdue', n(s.db.automation_runs.waiting_overdue)); g('RunsFailedLastHour', n(s.db.automation_runs.failed_last_hour));
  g('BillingEventsNeedingAttention', n(s.db.billing_events_needing_attention)); g('WebhookEventsUnprocessed', n(s.db.webhook_events_unprocessed));
  g('OutboundMessagesFailedLastHour', n(s.db.outbound_messages_failed_last_hour));
  g('WebhookDeliveriesOverdue', n(s.db.webhook_deliveries.overdue)); g('WebhookDeliveriesFailedLastHour', n(s.db.webhook_deliveries.failed_last_hour));
  g('WebhookEndpointsDisabled', n(s.db.webhook_endpoints_disabled));
  g('AiRunsLast15Min', n(s.db.ai.runs_last_15_min)); g('AiFailedLast15Min', n(s.db.ai.failed_last_15_min));
  if (s.db.ai.p95_latency_ms_24h !== null) g('AiLatencyP95Ms24h', n(s.db.ai.p95_latency_ms_24h));
  if (s.queues) { g('QueueRunsWaiting', s.queues.waiting); g('QueueRunsActive', s.queues.active); g('QueueRunsDelayed', s.queues.delayed); g('QueueRunsFailed', s.queues.failed); }
  g('WorkersAlive', s.workers.alive); g('WorkerHeartbeatAgeSeconds', s.workers.newestBeatAgeSeconds);
}

/**
 * Once a minute (called from the single maintenance job, so once per minute however many workers run): reads the database snapshot,
 * the queue depth and the worker heartbeats, publishes them as gauges for the EMF output, keeps the latest copy in memory and in Redis
 * (key `<QUEUE_PREFIX>:ops:snapshot`, 5 minute lifetime) so the Ops page and the alert rules can read it from any process.
 */
@Injectable()
export class HealthSnapshotService {
  private readonly log = new Logger('HealthSnapshot');
  latest: OpsSnapshot | null = null;
  private warned = false;

  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env, @Inject(WorkerHeartbeat) private readonly heartbeat: WorkerHeartbeat) {}

  async tick(queues: QueueCounts | null, now: Date = new Date()): Promise<OpsSnapshot> {
    const rows = await this.db.prisma.$queryRaw<{ s: DbSnapshot }[]>`SELECT ops_health_snapshot() AS s`;
    const beats = await this.heartbeat.list();
    const ages = beats.map((b) => Math.max(0, Math.round((now.getTime() - new Date(b.lastBeat).getTime()) / 1000)));
    const snap: OpsSnapshot = {
      generatedAt: now.toISOString(), db: (rows[0] as { s: DbSnapshot }).s, queues,
      workers: { alive: beats.length, newestBeatAgeSeconds: ages.length ? Math.min(...ages) : null, instances: beats },
    };
    this.latest = snap;
    publishGauges(snap);
    await this.store(snap);
    return snap;
  }

  private async store(snap: OpsSnapshot): Promise<void> {
    try {
      const r = this.heartbeat.client();
      if (r.status === 'wait' || r.status === 'end') await r.connect();
      await r.set(snapshotKey(this.env.QUEUE_PREFIX), JSON.stringify(snap), 'EX', SNAPSHOT_TTL_SECONDS);
      this.warned = false;
    } catch (e) {
      if (!this.warned) { this.warned = true; this.log.warn(`Snapshot not stored in Redis: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  /** Latest snapshot from any process (Redis), falling back to this process's own copy. */
  async readLatest(): Promise<OpsSnapshot | null> {
    try {
      const r = this.heartbeat.client();
      if (r.status === 'wait' || r.status === 'end') await r.connect();
      const raw = await r.get(snapshotKey(this.env.QUEUE_PREFIX));
      if (raw) return JSON.parse(raw) as OpsSnapshot;
    } catch { /* fall through */ }
    return this.latest;
  }
}
