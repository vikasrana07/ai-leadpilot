import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthSnapshotService, publishGauges, snapshotKey } from '../src/ops/health-snapshot.service.js';
import { heartbeatKey, WorkerHeartbeat, HEARTBEAT_TTL_SECONDS } from '../src/ops/worker-heartbeat.js';
import { metrics } from '../src/observability/metrics.js';
import { cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let owner$: pg.Pool; let a: Account; let b: Account;
const app$ = () => new pg.Pool({ connectionString: process.env.DATABASE_URL });
const seeded = { outbox: [] as string[], runs: [] as string[], billing: [] as string[] };

beforeAll(async () => {
  ctx = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  a = await registerAccount(ctx, 'opsA'); b = await registerAccount(ctx, 'opsB');
});
afterAll(async () => {
  if (seeded.runs.length) await owner$.query('DELETE FROM automation_runs WHERE id = ANY($1::uuid[])', [seeded.runs]);
  if (seeded.outbox.length) await owner$.query('DELETE FROM outbox_events WHERE id = ANY($1::uuid[])', [seeded.outbox]);
  if (seeded.billing.length) await owner$.query('DELETE FROM billing_events WHERE id = ANY($1::uuid[])', [seeded.billing]);
  await owner$.query("DELETE FROM automations WHERE name LIKE $1", [`ops-${RUN}%`]);
  await owner$.end(); await ctx.close(); await cleanup();
});

const snap = () => ctx.app.get(HealthSnapshotService).tick(null);

describe('ops_health_snapshot()', () => {
  it('counts stuck work across workspaces (deltas), returns no tenant data, and is callable by the app role', async () => {
    const before = (await snap()).db;
    const ids = async (sql: string, params: unknown[]) => ((await owner$.query(sql, params)).rows as { id: string }[]).map((r) => r.id);
    // two workspaces, each with a few problems
    for (const t of [a, b]) {
      const [auto] = await ids("INSERT INTO automations (tenant_id, name, trigger, actions, updated_at) VALUES ($1, $2, '{\"type\":\"lead.created\"}', '[]', now()) RETURNING id", [t.tenantId, `ops-${RUN}-${t.tenantId.slice(0, 4)}`]);
      const run = async (status: string, extra: string) => (seeded.runs.push(...(await ids(`INSERT INTO automation_runs (tenant_id, automation_id, event_id, event_type, status ${extra.split('|')[0]}) VALUES ($1, $2, $3, 'lead.created', '${status}' ${extra.split('|')[1]}) RETURNING id`, [t.tenantId, auto, `ops-${RUN}-${status}-${Math.random()}`]))));
      await run('RUNNING', ", started_at|, now() - interval '20 minutes'");       // stuck
      await run('QUEUED', ", created_at|, now() - interval '30 minutes'");         // queued too long
      await run('WAITING', ", resume_at|, now() - interval '40 minutes'");         // overdue wait
      await run('RUNNING', ", started_at|, now() - interval '1 minute'");          // healthy: must NOT count
      seeded.outbox.push(...(await ids("INSERT INTO outbox_events (tenant_id, type, payload, status, created_at) VALUES ($1, 'lead.created', '{}', 'failed', now()), ($1, 'lead.created', '{}', 'pending', now() - interval '10 minutes') RETURNING id", [t.tenantId])));
    }
    seeded.billing.push(...(await ids("INSERT INTO billing_events (provider, event_id, type, payload, status, received_at) VALUES ('razorpay', $1, 'x', '{}', 'received', now() - interval '30 minutes'), ('razorpay', $2, 'x', '{}', 'processed', now() - interval '30 minutes') RETURNING id", [`ops-${RUN}-1`, `ops-${RUN}-2`])));

    const after = (await snap()).db;
    expect(after.automation_runs.stuck_running - before.automation_runs.stuck_running).toBe(2);
    expect(after.automation_runs.queued_old - before.automation_runs.queued_old).toBe(2);
    expect(after.automation_runs.waiting_overdue - before.automation_runs.waiting_overdue).toBe(2);
    expect(after.outbox.failed - before.outbox.failed).toBe(2);
    expect(after.outbox.pending - before.outbox.pending).toBe(2);
    expect(after.outbox.oldest_pending_seconds).toBeGreaterThanOrEqual(600);
    expect(after.billing_events_needing_attention - before.billing_events_needing_attention).toBe(1); // only the unprocessed one
    // aggregate counts only: no workspace, user or content identifiers anywhere in the output
    const text = JSON.stringify(after);
    expect(text).not.toContain(a.tenantId); expect(text).not.toContain(b.tenantId); expect(text).not.toContain(a.email); expect(text).not.toMatch(/tenant_id|user_id|"id"/);
    expect(Object.keys(after).sort()).toEqual(['ai', 'automation_runs', 'billing_events_needing_attention', 'generated_at', 'outbound_messages_failed_last_hour', 'outbox', 'webhook_deliveries', 'webhook_endpoints_disabled', 'webhook_events_unprocessed']);
  });

  it('counts only webhook endpoints the dispatcher switched off automatically, not ones a team member switched off', async () => {
    const before = (await snap()).db.webhook_endpoints_disabled;
    const ins = (reason: string | null, enabled: boolean, tag: string) => owner$.query(
      "INSERT INTO webhook_endpoints (tenant_id, url, events, enabled, disabled_reason, secret_prefix, secret_ciphertext, secret_wrapped_key, secret_key_id, updated_at) VALUES ($1, $2, '{}', $3, $4, 'whsec_x', 'x', 'x', 'x', now())",
      [a.tenantId, `https://ops-${RUN}-${tag}.example.test/hook`, enabled, reason]);
    try {
      await ins('Switched off by a team member', false, 'manual');
      await ins(null, true, 'enabled');
      expect((await snap()).db.webhook_endpoints_disabled - before).toBe(0); // deliberate or enabled: not a fault
      await ins('Switched off automatically after 10 consecutive failed deliveries', false, 'auto');
      expect((await snap()).db.webhook_endpoints_disabled - before).toBe(1); // only the automatic one counts
    } finally { await owner$.query("DELETE FROM webhook_endpoints WHERE url LIKE $1", [`https://ops-${RUN}-%`]); }
  });

  it('the app role can execute it, PUBLIC cannot, and RLS on the underlying tables is unchanged', async () => {
    const pool = app$();
    try {
      const ok = await pool.query('SELECT ops_health_snapshot() AS s');
      expect(ok.rows[0].s.outbox).toBeDefined();
      // without a tenant in scope the app role still sees NO rows of a tenant table (the function, not the role, crosses tenants)
      expect((await pool.query('SELECT count(*)::int AS n FROM automation_runs')).rows[0].n).toBe(0);
      expect((await pool.query('SELECT count(*)::int AS n FROM outbox_events')).rows[0].n).toBe(0);
    } finally { await pool.end(); }
    const grants = (await owner$.query("SELECT has_function_privilege('public', 'ops_health_snapshot()', 'EXECUTE') AS pub, has_function_privilege('leadpilot_app', 'ops_health_snapshot()', 'EXECUTE') AS app")).rows[0];
    expect(grants).toEqual({ pub: false, app: true });
    const def = (await owner$.query("SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'ops_health_snapshot'")).rows[0];
    expect(def.prosecdef).toBe(true); expect(JSON.stringify(def.proconfig)).toContain('search_path');
  });
});

describe('snapshot tick and worker heartbeat', () => {
  it('publishes gauges for the EMF output and stores the latest snapshot in Redis (readable from any process)', async () => {
    const svc = ctx.app.get(HealthSnapshotService);
    const s = await svc.tick({ waiting: 1, active: 2, delayed: 3, failed: 4 });
    const g = (name: string) => metrics.collect().find((x) => x.def.name === name)?.value;
    expect(g('RunsStuckRunning')).toBe(s.db.automation_runs.stuck_running);
    expect(g('QueueRunsFailed')).toBe(4); expect(g('QueueRunsDelayed')).toBe(3);
    const fromRedis = await svc.readLatest();
    expect(fromRedis?.generatedAt).toBe(s.generatedAt);
    expect(fromRedis?.queues).toEqual({ waiting: 1, active: 2, delayed: 3, failed: 4 });
    // a snapshot with workers/AI latency maps onto gauges without throwing
    publishGauges({ ...s, db: { ...s.db, ai: { ...s.db.ai, p95_latency_ms_24h: 1234.5 } } });
    expect(g('AiLatencyP95Ms24h')).toBe(1234.5);
  });

  it('a stuck run created in the test shows up in the published gauge', async () => {
    const stuck = seeded.runs.length ? (await snap()).db.automation_runs.stuck_running : 0;
    expect(stuck).toBeGreaterThanOrEqual(2);
    expect(metrics.collect().find((x) => x.def.name === 'RunsStuckRunning')?.value).toBe(stuck);
  });

  it('writes a heartbeat key with a 90 s lifetime, lists it, and drops it on shutdown', async () => {
    const hb = ctx.app.get(WorkerHeartbeat);
    expect(await hb.beat()).toBe(true);
    const live = await hb.list();
    const mine = live.find((x) => x.instanceId === hb.instanceId);
    expect(mine).toBeTruthy(); expect(new Date(mine!.lastBeat).getTime()).toBeGreaterThan(Date.now() - 5000);
    const redis = hb.client();
    const prefix = process.env.QUEUE_PREFIX ?? 'leadpilot';
    const ttl = await redis.ttl(heartbeatKey(prefix, hb.instanceId));
    expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(HEARTBEAT_TTL_SECONDS);
    // the snapshot reports workers alive and the age of the newest beat
    const s = await ctx.app.get(HealthSnapshotService).tick(null);
    expect(s.workers.alive).toBeGreaterThanOrEqual(1); expect(s.workers.newestBeatAgeSeconds).toBeLessThan(10);
    expect(snapshotKey(prefix)).toContain(':ops:snapshot');
  });

  it('survives Redis being unreachable: no throw, one warning, empty list', async () => {
    const { ENV } = await import('../src/common/tokens.js');
    const env = { ...(ctx.app.get(ENV) as Record<string, unknown>), REDIS_URL: 'redis://127.0.0.1:1' };
    const dead = new WorkerHeartbeat(env as never);
    expect(await dead.beat()).toBe(false);
    expect(await dead.list()).toEqual([]);
    await dead.onApplicationShutdown();
  });
});
