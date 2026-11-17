import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LifecycleJobs } from '../src/ops/lifecycle-jobs.js';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/** Automation history retention: what is deleted, what is always kept, tenant isolation, idempotency, and that the app role itself cannot delete. */
let ctx: TestCtx; let jobs: LifecycleJobs; let db: pg.Pool; let app$: pg.Pool;
let a: Account; let b: Account;
const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
const n = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0].n as number;
let seq = 0;
const GRAPH = '{"v":1,"nodes":[{"id":"t","type":"trigger","data":{"type":"lead.created"}},{"id":"x","type":"action","data":{"type":"add_tag","tag":"r"}}],"edges":[{"id":"e","from":"t","to":"x","label":"next"}]}';

async function automation(t: Account): Promise<{ id: string; v1: string }> {
  const r = await ctx.http().post('/automations').set(auth(t.accessToken)).send({ name: `Retention ${++seq}`, cooldownMinutes: 0, graph: JSON.parse(GRAPH) });
  expect(r.status).toBe(201);
  const v1 = (await q(`SELECT active_version_id AS v FROM automations WHERE id = $1`, [r.body.id])).rows[0].v as string;
  await q(`UPDATE automation_versions SET created_at = now() - interval '400 days' WHERE id = $1`, [v1]); // old, but it is the live definition
  return { id: r.body.id as string, v1 };
}
async function version(t: Account, autoId: string, num: number, daysAgo: number): Promise<string> {
  return (await q(`INSERT INTO automation_versions (id, tenant_id, automation_id, version, source, graph, cooldown_minutes, created_at) VALUES (gen_random_uuid(), $1, $2, $3, 'graph', $4::jsonb, 0, now() - make_interval(days => $5)) RETURNING id`, [t.tenantId, autoId, num, GRAPH, daysAgo])).rows[0].id as string;
}
async function run(t: Account, autoId: string, versionId: string | null, status: string, daysAgo: number): Promise<string> {
  const finished = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'DRY_RUN'].includes(status);
  return (await q(`INSERT INTO automation_runs (id, tenant_id, automation_id, version_id, event_id, event_type, status, steps, created_at, finished_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'lead.created', $5::"RunStatus", '[]', now() - make_interval(days => $6), ${finished ? "now() - make_interval(days => $6)" : 'NULL'}) RETURNING id`, [t.tenantId, autoId, versionId, `ret-${++seq}-${Math.random()}`, status, daysAgo])).rows[0].id as string;
}
const exists = async (table: 'automation_runs' | 'automation_versions', id: string) => (await n(`SELECT count(*)::int n FROM ${table} WHERE id = $1`, [id])) === 1;

beforeAll(async () => {
  ctx = await createTestApp(); jobs = ctx.app.get(LifecycleJobs);
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL }); app$ = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  a = await registerAccount(ctx, 'arA'); b = await registerAccount(ctx, 'arB');
});
afterAll(async () => { await ctx.close(); await cleanup(); await db.end(); await app$.end(); });

describe('automation history retention', () => {
  let A: { id: string; v1: string }; let B: { id: string; v1: string };
  const ids: Record<string, string> = {};

  it('deletes old finished runs, old dry runs and unreferenced old versions; keeps everything live or referenced', async () => {
    A = await automation(a); B = await automation(b);
    const v2 = await version(a, A.id, 2, 400); const v3 = await version(a, A.id, 3, 400); const v4 = await version(a, A.id, 4, 400);
    const v5 = await version(a, A.id, 5, 400); const v6 = await version(a, A.id, 6, 10);
    Object.assign(ids, { v2, v3, v4, v5, v6 });
    // runs that must go
    ids.dryOld = await run(a, A.id, A.v1, 'DRY_RUN', 10); ids.okOld = await run(a, A.id, v3, 'SUCCEEDED', 200);
    ids.failOld = await run(a, A.id, A.v1, 'FAILED', 200); ids.skipOld = await run(a, A.id, A.v1, 'SKIPPED', 200);
    // runs that must stay
    ids.dryNew = await run(a, A.id, A.v1, 'DRY_RUN', 2); ids.okNew = await run(a, A.id, v5, 'SUCCEEDED', 100);
    ids.waiting = await run(a, A.id, v4, 'WAITING', 400); ids.queued = await run(a, A.id, A.v1, 'QUEUED', 400); ids.running = await run(a, A.id, A.v1, 'RUNNING', 400);
    // another workspace with the same shapes: must not be touched by a's purge
    ids.bDry = await run(b, B.id, B.v1, 'DRY_RUN', 10); ids.bOk = await run(b, B.id, B.v1, 'SUCCEEDED', 300); ids.bVer = await version(b, B.id, 2, 400);

    const preview = await jobs.runRetention(a.tenantId, { dry: true });
    expect(preview).toMatchObject({ automation_dry_runs: 1, automation_runs: 3 });
    expect(preview.automation_versions).toBeGreaterThanOrEqual(1);
    for (const id of [ids.dryOld, ids.okOld, ids.failOld, ids.skipOld]) expect(await exists('automation_runs', id!)).toBe(true); // a preview deletes nothing

    const done = await jobs.runRetention(a.tenantId);
    expect(done).toMatchObject({ automation_dry_runs: 1, automation_runs: 3, automation_versions: 2 }); // v2 (unreferenced) and v3 (freed by the run purge in the same pass)
    for (const k of ['dryOld', 'okOld', 'failOld', 'skipOld']) expect(await exists('automation_runs', ids[k]!), k).toBe(false);
    for (const k of ['dryNew', 'okNew', 'waiting', 'queued', 'running']) expect(await exists('automation_runs', ids[k]!), k).toBe(true);
    expect(await exists('automation_versions', ids.v2!)).toBe(false); expect(await exists('automation_versions', ids.v3!)).toBe(false);
    expect(await exists('automation_versions', A.v1)).toBe(true);        // the live definition, however old
    expect(await exists('automation_versions', ids.v4!)).toBe(true);     // a waiting run still points at it
    expect(await exists('automation_versions', ids.v5!)).toBe(true);     // a recent run still points at it
    expect(await exists('automation_versions', ids.v6!)).toBe(true);     // too recent
    for (const k of ['bDry', 'bOk']) expect(await exists('automation_runs', ids[k]!), k).toBe(true); // other workspace untouched
    expect(await exists('automation_versions', ids.bVer!)).toBe(true);

    const audit = (await q(`SELECT metadata FROM audit_logs WHERE tenant_id = $1 AND action = 'privacy.retention_purged' ORDER BY created_at DESC LIMIT 1`, [a.tenantId])).rows[0];
    expect(JSON.stringify(audit.metadata)).toContain('automation_versions');
  });

  it('is idempotent, and a run that is gone frees its version on the next pass', async () => {
    expect(Object.values(await jobs.runRetention(a.tenantId)).every((v) => v === 0)).toBe(true);
    await q(`UPDATE automation_runs SET status = 'SKIPPED', finished_at = now() - interval '300 days', created_at = now() - interval '300 days' WHERE id = $1`, [ids.waiting]); // the wait ended long ago
    const r = await jobs.runRetention(a.tenantId);
    expect(r.automation_runs).toBe(1); expect(r.automation_versions).toBe(1); // run gone, then its version (v4) in the same pass
    expect(await exists('automation_versions', ids.v4!)).toBe(false);
    expect(await exists('automation_versions', A.v1)).toBe(true);
  });

  it('applies to the other workspace only when its own purge runs', async () => {
    const r = await jobs.runRetention(b.tenantId);
    expect(r).toMatchObject({ automation_dry_runs: 1, automation_runs: 1, automation_versions: 1 });
    expect(await exists('automation_versions', B.v1)).toBe(true);
  });

  it('a workspace override shortens the period, and saving the privacy page without it does not lose it', async () => {
    // okNew is 100 days old: kept by the 180-day default
    expect(await exists('automation_runs', ids.okNew!)).toBe(true);
    const base = { webhookPayloadDays: 30, softDeletedLeadDays: 30, closedConversationDays: null, auditLogDays: null };
    const set = await ctx.http().put('/privacy/retention').set(auth(a.accessToken)).send({ ...base, automationRunDays: 30 });
    expect(set.status).toBe(200); expect(set.body.settings.automationRunDays).toBe(30);
    const again = await ctx.http().put('/privacy/retention').set(auth(a.accessToken)).send(base); // what the current privacy page sends
    expect(again.body.settings.automationRunDays).toBe(30);
    const tooShort = await ctx.http().put('/privacy/retention').set(auth(a.accessToken)).send({ ...base, automationRunDays: 1 });
    expect(tooShort.status).toBe(400);
    const r = await jobs.runRetention(a.tenantId);
    expect(r.automation_runs).toBe(1); expect(await exists('automation_runs', ids.okNew!)).toBe(false);
    expect(await exists('automation_runs', ids.dryNew!)).toBe(true); // 2 days old, inside the 7-day dry-run default
    expect(await exists('automation_runs', ids.queued!)).toBe(true); expect(await exists('automation_runs', ids.running!)).toBe(true);
  });

  it('the application role itself still cannot delete runs or versions (purging is only through the function)', async () => {
    const c = await app$.connect();
    try {
      for (const sql of [`DELETE FROM automation_runs WHERE id = $1`, `DELETE FROM automation_versions WHERE id = $1`]) {
        await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
        await expect(c.query(sql, [sql.includes('runs') ? ids.queued : ids.v6])).rejects.toThrow(/permission denied/);
        await c.query('ROLLBACK');
      }
    } finally { c.release(); }
    expect(await exists('automation_runs', ids.queued!)).toBe(true); expect(await exists('automation_versions', ids.v6!)).toBe(true);
  });

  it("workspace deletion removes the workspace's versions and runs too", async () => {
    const t = await registerAccount(ctx, 'arGone');
    const T = await automation(t); await run(t, T.id, T.v1, 'SUCCEEDED', 1); await run(t, T.id, T.v1, 'WAITING', 1);
    expect(await n(`SELECT count(*)::int n FROM automation_runs WHERE tenant_id = $1`, [t.tenantId])).toBe(2);
    await q(`SELECT purge_tenant($1::uuid)`, [t.tenantId]);
    for (const table of ['automation_runs', 'automation_versions', 'automations']) expect(await n(`SELECT count(*)::int n FROM ${table} WHERE tenant_id = $1`, [t.tenantId]), table).toBe(0);
  });
});
