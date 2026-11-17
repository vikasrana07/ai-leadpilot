import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AutomationEngine } from '../src/ops/automation-engine.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/** The cooldown is a property of the immutable version a run is pinned to, not of the live row's mirrored column. */
let ctx: TestCtx; let db: pg.Pool; let owner: Account; let relay: OutboxRelay; let engine: AutomationEngine; let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];
const G = (extra: unknown[], edges: unknown[]) => ({ v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'lead.stage_changed' } }, ...extra], edges });
const waitG = () => G([{ id: 'w', type: 'wait', data: { minutes: 60 } }, { id: 'x', type: 'action', data: { type: 'add_tag', tag: 'cd' } }], [{ id: 'a', from: 't', to: 'w', label: 'next' }, { id: 'b', from: 'w', to: 'x', label: 'timeout' }]);
const tagG = () => G([{ id: 'x', type: 'action', data: { type: 'add_tag', tag: 'cd' } }], [{ id: 'a', from: 't', to: 'x', label: 'next' }]);

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await relay.drainOnce(200);
    const pending = (await q<{ c: number }>(`SELECT count(*)::int c FROM outbox_events WHERE tenant_id = $1 AND status IN ('pending','processing')`, [owner.tenantId]))[0]?.c ?? 0;
    const queued = await q<{ id: string }>(`SELECT id FROM automation_runs WHERE tenant_id = $1 AND status = 'QUEUED'`, [owner.tenantId]);
    for (const r of queued) await engine.execute(owner.tenantId, r.id, true).catch(() => undefined);
    if (pending === 0 && queued.length === 0) return;
    await sleep(40);
  }
  throw new Error('outbox did not settle');
}
const mkLead = async () => (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Cooldown Lead ${++n}`, phone: `97${String(50_000_000 + n * 104729 + Math.floor(Math.random() * 1000)).slice(0, 8)}` })).body.id as string;
const create = async (graph: unknown, cooldownMinutes: number) => {
  const r = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: `Cooldown ${++n}`, cooldownMinutes, graph });
  expect(r.status).toBe(201);
  expect((await ctx.http().post(`/automations/${r.body.id}/enable`).set(auth(owner.accessToken)).send({ enabled: true })).status).toBe(200);
  return r.body as { id: string; version: number };
};
let stageFlip = 0;
async function changeStage(leadId: string) {
  const open = ((await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken))).body.stages as { id: string; kind: string }[]).filter((s) => s.kind === 'OPEN');
  const r = await ctx.http().post(`/leads/${leadId}/stage`).set(auth(owner.accessToken)).send({ stageId: open[(++stageFlip % (open.length - 1)) + 1]!.id });
  expect(r.status).toBeLessThan(300); await settle();
}
const runs = (id: string) => q<{ status: string; version_id: string; steps: { type: string; detail?: string }[] }>(`SELECT status, version_id, steps FROM automation_runs WHERE automation_id = $1 ORDER BY created_at`, [id]);

beforeAll(async () => {
  ctx = await createTestApp(); relay = ctx.app.get(OutboxRelay); engine = ctx.app.get(AutomationEngine);
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL }); owner = await registerAccount(ctx, 'cdOwner');
});
afterEach(async () => { await q(`UPDATE automations SET enabled = false WHERE tenant_id = $1`, [owner.tenantId]); await q(`UPDATE automation_runs SET status = 'SKIPPED' WHERE tenant_id = $1 AND status = 'WAITING'`, [owner.tenantId]); await settle(); });
afterAll(async () => { await db.end(); await ctx.close(); await cleanup(); });

describe('pinned-version cooldown', () => {
  it("uses the version's cooldown even when the live row's mirrored column disagrees (both directions)", async () => {
    const strict = await create(tagG(), 60); const loose = await create(tagG(), 0);
    await q(`UPDATE automations SET cooldown_minutes = 0 WHERE id = $1`, [strict.id]);   // drifted mirror says "no cooldown"
    await q(`UPDATE automations SET cooldown_minutes = 600 WHERE id = $1`, [loose.id]);  // drifted mirror says "10 hours"
    const lead = await mkLead(); await changeStage(lead); await changeStage(lead);
    const s = await runs(strict.id); const l = await runs(loose.id);
    expect(s.map((r) => r.status)).toEqual(['SUCCEEDED', 'SKIPPED']); expect(s[1]!.steps[0]).toMatchObject({ type: 'gate', detail: 'cooldown' });
    expect(l.map((r) => r.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
  });

  it('editing the cooldown while a run waits: the waiting run keeps its version, new events follow the new cooldown', async () => {
    const a = await create(waitG(), 60);
    const lead = await mkLead(); await changeStage(lead);
    expect((await runs(a.id)).map((r) => r.status)).toEqual(['WAITING']);
    // same lead again inside the old 60 minutes: skipped by the cooldown of v1
    await changeStage(lead);
    expect((await runs(a.id)).map((r) => r.status)).toEqual(['WAITING', 'SKIPPED']);
    // the owner turns the cooldown off: a new version
    const put = await ctx.http().put(`/automations/${a.id}`).set(auth(owner.accessToken)).send({ name: 'Edited cooldown', cooldownMinutes: 0, graph: waitG(), expectedVersion: a.version });
    expect(put.status).toBe(200); expect(put.body.version).toBe(a.version + 1);
    await changeStage(lead);
    const after = await runs(a.id);
    expect(after.map((r) => r.status)).toEqual(['WAITING', 'SKIPPED', 'WAITING']); // the third pinned to v2 (no cooldown)
    expect(new Set([after[0]!.version_id, after[2]!.version_id]).size).toBe(2);
    expect((await q<{ cooldown_minutes: number }>(`SELECT cooldown_minutes FROM automation_versions WHERE id = $1`, [after[0]!.version_id]))[0]!.cooldown_minutes).toBe(60); // v1 is unchanged
    // and back to a long cooldown: the next event is held again
    const put2 = await ctx.http().put(`/automations/${a.id}`).set(auth(owner.accessToken)).send({ name: 'Edited cooldown', cooldownMinutes: 120, graph: waitG(), expectedVersion: a.version + 1 });
    expect(put2.status).toBe(200);
    await changeStage(lead);
    expect((await runs(a.id)).map((r) => r.status)).toEqual(['WAITING', 'SKIPPED', 'WAITING', 'SKIPPED']);
  });
});
