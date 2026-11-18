import argon2 from 'argon2';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.module.js';
import { ENV } from '../src/common/tokens.js';
import type { Env } from '../src/config/env.js';
import { AlertsService, EMAIL_DAMPING_MINUTES } from '../src/ops/alerts.service.js';
import { HealthSnapshotService, type DbSnapshot, type OpsSnapshot } from '../src/ops/health-snapshot.service.js';
import { WorkerHeartbeat } from '../src/ops/worker-heartbeat.js';
import { metrics } from '../src/observability/metrics.js';
import type { AlertInput } from '../src/ops/alert-rules.js';
import { MailService } from '../src/mail/mail.module.js';
import { auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, type FakeMail, type TestCtx } from './helpers.js';

const RECIPIENT = `ops-${RUN}@example.test`;
process.env.ALERTS_ENABLED = 'true';
process.env.ALERT_EMAIL_TO = RECIPIENT;
process.env.ALERT_REPEAT_HOURS = '6';

let ctx: TestCtx; let alerts: AlertsService; let db: DbService;
const owner = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
const T0 = new Date('2026-11-17T10:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const quietDb = (): DbSnapshot => ({
  generated_at: T0.toISOString(), outbox: { pending: 0, oldest_pending_seconds: 0, failed: 0 },
  automation_runs: { stuck_running: 0, queued_old: 0, waiting_overdue: 0, failed_last_hour: 0 }, billing_events_needing_attention: 0, webhook_events_unprocessed: 0,
  outbound_messages_failed_last_hour: 0, webhook_deliveries: { overdue: 0, failed_last_hour: 0 }, webhook_endpoints_disabled: 0, ai: { runs_last_15_min: 0, failed_last_15_min: 0, p95_latency_ms_24h: null },
});
const input = (patch: (d: DbSnapshot) => void = () => undefined, over: Partial<AlertInput> = {}): AlertInput => {
  const d = quietDb(); patch(d);
  const snapshot: OpsSnapshot = { generatedAt: T0.toISOString(), db: d, queues: null, workers: { alive: 1, newestBeatAgeSeconds: 1, instances: [] } };
  return { snapshot, snapshotAgeSeconds: 5, workersAlive: 1, ...over };
};
const noWorker = () => input(undefined, { workersAlive: 0 });
const ok = () => input();
const ev = (now: Date, i: AlertInput) => alerts.evaluate(now, { input: i });
const mail = () => ctx.mail as FakeMail;
const alertMails = () => mail().sent.filter((m) => m.kind === 'alert' && m.to === RECIPIENT);
const row = async (key: string) => (await owner.query('SELECT * FROM ops_alerts WHERE key = $1', [key])).rows[0] as Record<string, unknown> | undefined;

beforeAll(async () => { ctx = await createTestApp(); alerts = ctx.app.get(AlertsService); db = ctx.app.get(DbService); });
afterAll(async () => { await owner.query('DELETE FROM ops_alerts'); await ctx.close(); await cleanup(); await owner.end(); });
beforeEach(async () => { await owner.query('DELETE FROM ops_alerts'); (mail().sent as unknown[]).length = 0; });

describe('alert state machine', () => {
  it('fires only after the rule has been breached for its minutes in a row, and sends exactly one email', async () => {
    expect((await ev(at(0), noWorker())).transitions).toEqual([]);
    expect((await ev(at(1), noWorker())).transitions).toEqual([]);
    expect(alertMails()).toHaveLength(0);
    const r = await ev(at(2), noWorker()); // worker_not_running: forMinutes 3
    expect(r.transitions).toEqual([{ key: 'worker_not_running', to: 'firing' }]);
    expect(r.emails).toBe(1);
    const m = alertMails();
    expect(m).toHaveLength(1);
    expect(m[0]?.subject).toBe('[LeadPilot FIRING] Sev 2: No background worker is running');
    expect((await row('worker_not_running'))?.status).toBe('firing');
    // still breached: no second email
    await ev(at(3), noWorker()); await ev(at(4), noWorker());
    expect(alertMails()).toHaveLength(1);
  });

  it('a short blip does not fire: the streak resets when the rule is fine again', async () => {
    await ev(at(0), noWorker()); await ev(at(1), noWorker()); await ev(at(2), ok()); await ev(at(3), noWorker()); await ev(at(4), noWorker());
    expect((await row('worker_not_running'))?.status).toBe('resolved');
    expect(alertMails()).toHaveLength(0);
  });

  it('resolves after two fine evaluations (not one), and the resolved email respects the damping window', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker());
    expect(alertMails()).toHaveLength(1); // firing, sent at minute 2
    await ev(at(3), ok());
    expect((await row('worker_not_running'))?.status).toBe('firing'); // one fine evaluation is not enough
    const r = await ev(at(4), ok());
    expect(r.transitions).toEqual([{ key: 'worker_not_running', to: 'resolved' }]);
    expect(alertMails()).toHaveLength(1); // resolved email is held back: the firing email went out only 2 minutes ago
    expect((await row('worker_not_running'))?.resolve_notify_due).toBe(true);
    await ev(at(5 + EMAIL_DAMPING_MINUTES), ok()); // later, damping over
    const mails = alertMails();
    expect(mails).toHaveLength(2);
    expect(mails[1]?.subject).toContain('RESOLVED');
    await ev(at(40), ok());
    expect(alertMails()).toHaveLength(2); // and only once
  });

  it('a fast flap does not email twice within the damping window; the re-fire email is sent once the window has passed', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker()); // fires, email 1 at minute 2
    await ev(at(3), ok()); await ev(at(4), ok()); // resolves (email held)
    for (let m = 5; m < 8; m++) await ev(at(m), noWorker()); // fires again at minute 7, inside the damping window
    expect(alertMails()).toHaveLength(1);
    await ev(at(2 + EMAIL_DAMPING_MINUTES + 1), noWorker()); // window over, still firing: the suppressed email goes out now
    expect(alertMails()).toHaveLength(2);
    expect(alertMails()[1]?.subject).toContain('FIRING');
  });

  it('repeats a still-firing Sev 1-2 alert every ALERT_REPEAT_HOURS, but never repeats Sev 3', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker()); // Sev 2
    const sev3 = () => input((d) => { d.outbox.failed = 2; }, { workersAlive: 0 });
    await ev(at(3), sev3()); // outbox_failed fires immediately (forMinutes 1), Sev 3
    expect(alertMails().map((m) => m.subject)).toEqual(['[LeadPilot FIRING] Sev 2: No background worker is running', '[LeadPilot FIRING] Sev 3: Outbox events have failed']);
    await ev(at(5 * 60), sev3()); // 5 h: nothing due
    expect(alertMails()).toHaveLength(2);
    await ev(at(6 * 60 + 5), sev3()); // 6 h later: Sev 2 repeats, Sev 3 does not
    const subjects = alertMails().map((m) => m.subject);
    expect(subjects).toHaveLength(3);
    expect(subjects[2]).toBe('[LeadPilot STILL FIRING] Sev 2: No background worker is running');
  });

  it('two evaluators racing on the same state send each email once (compare-and-set in the database)', async () => {
    for (let m = 0; m < 2; m++) await ev(at(m), noWorker());
    const [a, b] = await Promise.all([ev(at(2), noWorker()), ev(at(2), noWorker())]);
    expect(a.transitions.length + b.transitions.length).toBe(1);
    expect(alertMails()).toHaveLength(1);
    // (two evaluations racing each count as a fine minute, so the alert may resolve one step early; what must hold is: exactly one resolve)
    const done = [...(await Promise.all([ev(at(3), ok()), ev(at(3), ok())])), ...(await Promise.all([ev(at(4), ok()), ev(at(4), ok())]))];
    expect(done.reduce((n, r) => n + r.transitions.length, 0)).toBe(1);
    await Promise.all([ev(at(40), ok()), ev(at(40), ok())]);
    expect(alertMails()).toHaveLength(2); // one firing, one resolved
  });

  it('missing data leaves state alone: database rules are skipped without a fresh snapshot, and snapshot_stale fires instead', async () => {
    const stale = (): AlertInput => ({ ...input((d) => { d.outbox.failed = 9; }), snapshotAgeSeconds: 900 });
    const r1 = await ev(at(0), stale()); await ev(at(1), stale());
    expect(r1.unknown).toBeGreaterThan(5);
    expect(await row('outbox_failed')).toBeUndefined();
    expect((await row('snapshot_stale'))?.status).toBe('firing'); // forMinutes 2
    expect(alertMails().map((m) => m.subject)).toEqual(['[LeadPilot FIRING] Sev 2: Health snapshot is stale: the maintenance job is not running']);
  });

  it('records numbers only, and the email text contains no personal data', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker());
    const stored = await row('worker_not_running');
    expect(stored?.last_value).toEqual({ workersAlive: 0 });
    const text = alertMails()[0]?.text ?? '';
    expect(text).toContain('Alert: worker_not_running');
    expect(text).not.toContain(RECIPIENT);
    expect(text).not.toMatch(/@/);
  });

  it('publishes the number of firing alerts as a metric', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker());
    const gauge = (name: string) => metrics.collect().find((s) => s.def.name === name)?.value;
    expect(gauge('AlertsFiring')).toBe(1); expect(gauge('AlertsFiringSev2')).toBe(1); expect(gauge('AlertsFiringSev1')).toBe(0);
  });
});

describe('alert delivery edge cases', () => {
  const mk = (env: Partial<Env>, mailer?: unknown) => new AlertsService(db, { ...(ctx.app.get(ENV) as Env), ...env } as Env, (mailer ?? ctx.app.get(MailService)) as MailService, ctx.app.get(HealthSnapshotService), ctx.app.get(WorkerHeartbeat));

  it('does nothing when ALERTS_ENABLED is off (no state, no email)', async () => {
    const off = mk({ ALERTS_ENABLED: false });
    for (let m = 0; m < 4; m++) await off.evaluate(at(m), { input: noWorker() });
    expect(await row('worker_not_running')).toBeUndefined();
    expect(alertMails()).toHaveLength(0);
  });

  it('a failing mail provider never breaks evaluation, and the state still changes', async () => {
    const broken = mk({}, { sendAlert: async () => { throw new Error('smtp down'); } });
    let last: Awaited<ReturnType<AlertsService['evaluate']>> | undefined;
    for (let m = 0; m < 3; m++) last = await broken.evaluate(at(m), { input: noWorker() });
    expect(last?.transitions).toEqual([{ key: 'worker_not_running', to: 'firing' }]);
    expect((await row('worker_not_running'))?.status).toBe('firing');
  });

  it('with no ALERT_EMAIL_TO the email goes to the active platform admins', async () => {
    const admin = `padmin-${RUN}@example.test`;
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await owner.query("INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'Alert Admin')", [admin, hash]);
    try {
      const toAdmins = mk({ ALERT_EMAIL_TO: undefined });
      for (let m = 0; m < 3; m++) await toAdmins.evaluate(at(m), { input: noWorker() });
      expect(mail().sent.some((s) => s.kind === 'alert' && s.to === admin)).toBe(true);
    } finally { await owner.query('DELETE FROM platform_admins WHERE email = $1', [admin]); }
  });
});

describe('ops_alerts is platform-only', () => {
  it('is invisible and read-only from inside any tenant context', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker());
    expect((await row('worker_not_running'))?.status).toBe('firing');
    const t = await registerAccount(ctx, 'alertTenant');
    const seen = await db.tenantTx({ tenantId: t.tenantId, userId: t.userId }, (tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM ops_alerts`);
    expect(seen[0]?.n).toBe(0);
    await expect(db.tenantTx({ tenantId: t.tenantId, userId: t.userId }, (tx) => tx.$executeRaw`INSERT INTO ops_alerts (key, severity, title) VALUES ('x', 3, 'x')`)).rejects.toThrow();
    // and the app role can never delete alert history
    await expect(db.prisma.$executeRaw`DELETE FROM ops_alerts`).rejects.toThrow(/permission denied/i);
  });
});

describe('GET /platform/ops', () => {
  const admin = `ops-admin-${RUN}@example.test`;
  let token = '';
  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await owner.query("INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'Ops Admin')", [admin, hash]);
    const login = await ctx.http().post('/platform/auth/login').send({ email: admin, password: PASSWORD });
    token = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform='))?.split(';')[0]?.split('=')[1] ?? '';
  });
  afterAll(async () => { await owner.query('DELETE FROM platform_admins WHERE email = $1', [admin]); });

  it('needs a platform session: no cookie, or a tenant token, is a 401', async () => {
    expect((await ctx.http().get('/platform/ops')).status).toBe(401);
    const t = await registerAccount(ctx, 'opsTenant');
    expect((await ctx.http().get('/platform/ops').set(auth(t.accessToken))).status).toBe(401);
  });

  it('returns firing alerts, live rule state, SLOs and no tenant data to a platform admin', async () => {
    for (let m = 0; m < 3; m++) await ev(at(m), noWorker());
    const res = await ctx.http().get('/platform/ops').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.alertsEnabled).toBe(true);
    expect(res.body.firing.map((a: { key: string }) => a.key)).toContain('worker_not_running');
    expect(res.body.firing[0]).toMatchObject({ severity: 2, status: 'firing', runbook: 'docs/runbooks/worker-and-queues.md' });
    expect(res.body.rules.length).toBeGreaterThan(8);
    expect(res.body.slos.map((s: { id: number }) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(res.body.snapshot).toHaveProperty('stale');
    expect(JSON.stringify(res.body)).not.toMatch(/tenant_id|tenantId/);
  });
});
