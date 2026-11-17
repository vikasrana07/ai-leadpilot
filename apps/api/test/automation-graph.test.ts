import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { effectiveGraph, graphToLinear, linearToGraph, validateGraph, graphErrors } from '@leadpilot/validation';
import { ConversationsService } from '../src/conversations/conversations.service.js';
import { InboundService } from '../src/conversations/inbound.service.js';
import { DbService } from '../src/db/db.module.js';
import { AutomationEngine } from '../src/ops/automation-engine.js';
import { AUTOMATION_TEMPLATES } from '../src/ops/automation-templates.js';
import { resumeWaitingRun } from '../src/ops/graph-executor.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { ScannersService } from '../src/ops/scanners.service.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let owner$: pg.Pool; let owner: Account; let other: Account;
let relay: OutboxRelay; let engine: AutomationEngine; let scanners: ScannersService; let channelId = '';
let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await owner$.query(sql, args)).rows as T[];

// ---- graph builders
type Node = { id: string; type: string; data: unknown };
const trig = (type = 'lead.created') => ({ id: 't', type: 'trigger', data: { type } });
const tag = (id: string, name: string) => ({ id, type: 'action', data: { type: 'add_tag', tag: name } });
const task = (id: string, title: string) => ({ id, type: 'action', data: { type: 'create_task', title, dueInHours: 1, assignee: 'lead_owner' } });
const wait = (id: string, minutes = 60) => ({ id, type: 'wait', data: { minutes } });
const branch = (id: string, conditions: unknown[], match: 'all' | 'any' = 'all') => ({ id, type: 'branch', data: { match, conditions } });
const edge = (from: string, to: string, label = 'next') => ({ id: `${from}-${to}-${label}`, from, to, label });
const G = (nodes: Node[], edges: unknown[]) => ({ v: 1, nodes, edges });

const mkLead = async (extra: Record<string, unknown> = {}) => {
  const r = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Graph Lead ${++n}`, phone: `97${String(40_000_000 + n * 104729 + Math.floor(Math.random() * 1000)).slice(0, 8)}`, ...extra });
  if (r.status !== 201) throw new Error(`lead create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};
const consent = (leadId: string, status = 'OPTED_IN') => q(`INSERT INTO consents (id, tenant_id, lead_id, channel, status, source) VALUES (gen_random_uuid(), $1, $2, 'whatsapp', $3::"ConsentStatus", 'test')`, [owner.tenantId, leadId, status]);
const createGraph = async (graph: unknown, extra: Record<string, unknown> = {}, enable = true) => {
  const r = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: `Graph ${++n}`, cooldownMinutes: 0, graph, ...extra });
  if (r.status !== 201) throw new Error(`graph create failed ${r.status} ${JSON.stringify(r.body)}`);
  if (enable) { const e = await ctx.http().post(`/automations/${r.body.id}/enable`).set(auth(owner.accessToken)).send({ enabled: true }); if (e.status !== 200) throw new Error(`enable failed ${JSON.stringify(e.body)}`); }
  return r.body as { id: string; version: number; graph: unknown; summary: string[] };
};
type RunRow = { id: string; status: string; steps: { i: number; nodeId?: string; type: string; status: string; detail?: string; branch?: string }[]; lead_id: string; resume_at: string | null; waiting_node: string | null; version_id: string | null; attempts: number };
const runsOf = (automationId: string) => q<RunRow>(`SELECT id, status, steps, lead_id, resume_at, waiting_node, version_id, attempts FROM automation_runs WHERE automation_id = $1 ORDER BY created_at`, [automationId]);
const tagsOf = async (leadId: string) => (await q<{ name: string }>(`SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1 ORDER BY t.name`, [leadId])).map((x) => x.name);
const tasksOf = async (leadId: string) => (await q<{ title: string }>(`SELECT title FROM tasks WHERE lead_id = $1 ORDER BY created_at`, [leadId])).map((x) => x.title);

async function settle(tenantId = owner.tenantId): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await relay.drainOnce(200);
    const pending = (await q<{ c: number }>(`SELECT count(*)::int c FROM outbox_events WHERE tenant_id = $1 AND status IN ('pending','processing')`, [tenantId]))[0]?.c ?? 0;
    const queued = await q<{ id: string }>(`SELECT id FROM automation_runs WHERE tenant_id = $1 AND status = 'QUEUED'`, [tenantId]);
    for (const r of queued) await engine.execute(tenantId, r.id, true).catch(() => undefined);
    if (pending === 0 && queued.length === 0) return;
    await sleep(40);
  }
  throw new Error('outbox did not settle');
}
/** The run for this lead, once it exists (another test file's relay may have claimed the event and still be committing it). */
async function runFor(automationId: string, leadId: string): Promise<RunRow> {
  for (let i = 0; i < 100; i++) {
    await relay.drainOnce(200);
    const r = (await runsOf(automationId)).find((x) => x.lead_id === leadId);
    if (r) return r;
    await sleep(100);
  }
  throw new Error('run was not created');
}
/** Pretends the wait deadline has passed and lets the minute scanner resume the run. */
async function expire(runId: string) {
  await q(`UPDATE automation_runs SET resume_at = now() - interval '1 second' WHERE id = $1`, [runId]);
  const rep = await scanners.scanTenant(owner.tenantId);
  expect(rep.waitsResumed).toBeGreaterThanOrEqual(1);
  await settle();
}

beforeAll(async () => {
  ctx = await createTestApp();
  relay = ctx.app.get(OutboxRelay); engine = ctx.app.get(AutomationEngine); scanners = ctx.app.get(ScannersService);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'agOwner'); other = await registerAccount(ctx, 'agOther');
  const phoneId = `63${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ name: 'Graph line', phoneNumberId: phoneId, wabaId: `64${phoneId.slice(2)}`, accessToken: 'EAAGgraphTestToken1234567890123', appSecret: 'graph-test-secret-1234567890' });
  if (ch.status !== 201) throw new Error(`channel failed ${JSON.stringify(ch.body)}`);
  channelId = ch.body.id;
  const t = await ctx.http().post('/whatsapp/templates').set(auth(owner.accessToken)).send({ name: 'welcome_lead', bodyPreview: 'Hi {{1}}, welcome to {{2}}' });
  if (t.status !== 201) throw new Error(`template failed ${JSON.stringify(t.body)}`);
});
afterEach(async () => { await q(`UPDATE automations SET enabled = false WHERE tenant_id = $1`, [owner.tenantId]); await q(`UPDATE automation_runs SET status = 'SKIPPED' WHERE tenant_id = $1 AND status = 'WAITING'`, [owner.tenantId]); await settle(); });
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('the 8 starter templates as graphs', () => {
  it('convert losslessly, validate, and run through the graph path unchanged', async () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const lin = { trigger: t.trigger, conditions: t.conditions, actions: t.actions };
      const g = linearToGraph(lin);
      expect(graphErrors(validateGraph(g)), t.key).toEqual([]);
      expect(graphToLinear(g), t.key).toEqual(lin);
    }
    const res = await ctx.http().get('/automations/templates').set(auth(owner.accessToken));
    expect(res.status).toBe(200);
    for (const it of res.body.items) { expect(it.graph.v).toBe(1); expect(it.summary[0]).toMatch(/^When /); }
  });

  it('a legacy automation row with no version gets one on its first event and runs pinned to it', async () => {
    const id = (await q<{ id: string }>(`INSERT INTO automations (id, tenant_id, name, enabled, trigger, conditions, actions, cooldown_minutes, updated_at) VALUES (gen_random_uuid(), $1, 'Legacy row', true, '{"type":"lead.created"}', '[]', '[{"type":"add_tag","tag":"legacy-tag"}]', 0, now()) RETURNING id`, [owner.tenantId]))[0]!.id;
    const l = await mkLead(); await settle();
    const run = (await runsOf(id))[0]!;
    expect(run.status).toBe('SUCCEEDED'); expect(run.version_id).toBeTruthy();
    expect(await tagsOf(l)).toContain('legacy-tag');
    expect((await q<{ source: string; version: number }>(`SELECT source, version FROM automation_versions WHERE automation_id = $1`, [id]))).toEqual([{ source: 'linear', version: 1 }]);
    expect(run.steps[0]).toMatchObject({ i: 0, nodeId: 'a1', status: 'done' }); // step index = action index, as before
  });
});

describe('graph API: create, validate, version, concurrency', () => {
  it('rejects invalid graphs with the issue list, and validates without writing', async () => {
    const cyc = G([trig(), tag('a', 'x'), tag('b', 'y')], [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')]);
    const r = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Cycle', graph: cyc });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('invalid_graph'); expect(JSON.stringify(r.body.error.details)).toContain('cycle');
    const nodes = [trig(), ...Array.from({ length: 25 }, (_, i) => tag(`n${i}`, `t${i}`))];
    const big = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Big', graph: G(nodes, []) });
    expect(big.status).toBe(400);
    const before = (await q<{ c: number }>(`SELECT count(*)::int c FROM automations WHERE tenant_id = $1`, [owner.tenantId]))[0]!.c;
    const v = await ctx.http().post('/automations/validate').set(auth(owner.accessToken)).send({ graph: G([trig(), branch('b', [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }]), tag('a', 'hot')], [edge('t', 'b'), edge('b', 'a', 'yes')]) });
    expect(v.status).toBe(200); expect(v.body.ok).toBe(true);
    expect(v.body.issues.map((i: { code: string }) => i.code)).toContain('branch_open'); // a warning, not an error
    expect(v.body.summary.join('\n')).toContain('If temperature is HOT');
    expect((await ctx.http().post('/automations/validate').set(auth(owner.accessToken)).send({ graph: cyc })).body.ok).toBe(false);
    expect((await q<{ c: number }>(`SELECT count(*)::int c FROM automations WHERE tenant_id = $1`, [owner.tenantId]))[0]!.c).toBe(before);
    // unknown stage reference is reported against the node
    const bad = await ctx.http().post('/automations/validate').set(auth(owner.accessToken)).send({ graph: G([trig(), { id: 's', type: 'action', data: { type: 'change_stage', stageKey: 'no_such_stage' } }], [edge('t', 's')]) });
    expect(bad.body.ok).toBe(false); expect(bad.body.issues.find((i: { code: string }) => i.code === 'invalid_stage').nodeId).toBe('s');
  });

  it('versions every definition change, keeps renames out of history, and refuses a stale save (409)', async () => {
    const a = await createGraph(G([trig(), tag('a', 'v1')], [edge('t', 'a')]), {}, false);
    expect(a.version).toBe(1); expect(a.summary.join('\n')).toContain('add the tag "v1"');
    const put = (b: Record<string, unknown>) => ctx.http().put(`/automations/${a.id}`).set(auth(owner.accessToken)).send(b);
    const g2 = G([trig(), tag('a', 'v2')], [edge('t', 'a')]);
    const r2 = await put({ name: 'Renamed', graph: g2, cooldownMinutes: 0, expectedVersion: 1 });
    expect(r2.status).toBe(200); expect(r2.body.version).toBe(2);
    expect((await put({ name: 'Renamed again', graph: g2, cooldownMinutes: 0, expectedVersion: 2 })).body.version).toBe(2); // same definition: no new version
    const stale = await put({ name: 'Stale', graph: G([trig(), tag('a', 'v3')], [edge('t', 'a')]), cooldownMinutes: 0, expectedVersion: 1 });
    expect(stale.status).toBe(409); expect(stale.body.error.code).toBe('version_conflict');
    const list = await ctx.http().get(`/automations/${a.id}/versions`).set(auth(owner.accessToken));
    expect(list.body.items.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    // a legacy body still works on a graph automation's sibling: legacy rows keep their linear columns and get linear versions
    const lin = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Linear', trigger: { type: 'lead.created' }, conditions: [], actions: [{ type: 'add_tag', tag: 'lin' }], cooldownMinutes: 0 });
    expect(lin.status).toBe(201); expect(lin.body.graphAuthored).toBe(false); expect(lin.body.graph.nodes.map((x: { id: string }) => x.id)).toEqual(['t', 'a1']);
    const lin2 = await ctx.http().put(`/automations/${lin.body.id}`).set(auth(owner.accessToken)).send({ name: 'Linear', trigger: { type: 'lead.created' }, conditions: [], actions: [{ type: 'add_tag', tag: 'lin2' }], cooldownMinutes: 0 });
    expect(lin2.body.version).toBe(2);
    expect((await q<{ source: string }>(`SELECT source FROM automation_versions WHERE automation_id = $1 ORDER BY version`, [lin.body.id])).map((x) => x.source)).toEqual(['linear', 'linear']);
    // another workspace cannot see it
    expect((await ctx.http().get(`/automations/${a.id}/versions`).set(auth(other.accessToken))).status).toBe(404);
  });
});

describe('branching', () => {
  it('any / all conditions pick the yes or no path, and the decision is recorded', async () => {
    const hotOrBig = branch('b', [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }, { field: 'lead.location', op: 'eq', value: 'wakad' }], 'any');
    const both = branch('b', [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }, { field: 'lead.location', op: 'eq', value: 'wakad' }], 'all');
    const any = await createGraph(G([trig(), hotOrBig, tag('y', 'yes-path'), tag('n', 'no-path')], [edge('t', 'b'), edge('b', 'y', 'yes'), edge('b', 'n', 'no')]));
    const all = await createGraph(G([trig(), both, tag('y', 'all-yes'), tag('n', 'all-no')], [edge('t', 'b'), edge('b', 'y', 'yes'), edge('b', 'n', 'no')]));
    const l1 = await mkLead({ location: 'Wakad' }); const l2 = await mkLead({ location: 'Baner' });
    await settle();
    expect(await tagsOf(l1)).toEqual(['all-no', 'yes-path']); // location matches (any) but temperature is not HOT (all)
    expect(await tagsOf(l2)).toEqual(['all-no', 'no-path']);
    const run = (await runsOf(any.id)).find((r) => r.lead_id === l1)!;
    expect(run.status).toBe('SUCCEEDED');
    expect(run.steps.map((s) => `${s.nodeId}:${s.type}:${s.branch ?? s.status}`)).toEqual(['b:branch:yes', 'y:add_tag:done']);
    expect((await runsOf(all.id)).length).toBe(2);
  });
});

describe('wait nodes', () => {
  it('parks the run (nothing sleeps), resumes at the deadline once, and does not repeat finished steps', async () => {
    const a = await createGraph(G([trig(), task('k1', 'before wait'), wait('w', 60), task('k2', 'after wait')], [edge('t', 'k1'), edge('k1', 'w'), edge('w', 'k2', 'timeout')]));
    const l = await mkLead(); await settle();
    const run = (await runsOf(a.id))[0]!;
    expect(run.status).toBe('WAITING'); expect(run.waiting_node).toBe('w');
    expect(new Date(run.resume_at as string).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(await tasksOf(l)).toEqual(['before wait']);
    expect((await scanners.scanTenant(owner.tenantId)).waitsResumed).toBe(0); // not due yet
    await expire(run.id);
    const after = (await runsOf(a.id))[0]!;
    expect(after.status).toBe('SUCCEEDED'); expect(after.resume_at).toBeNull();
    expect(await tasksOf(l)).toEqual(['before wait', 'after wait']);
    expect(after.steps.find((s) => s.type === 'wait')).toMatchObject({ status: 'done', branch: 'timeout' });
    // compare-and-set: resuming something that is no longer waiting does nothing
    expect(await ctx.app.get(DbService).tenantTx({ tenantId: owner.tenantId }, (tx) => resumeWaitingRun(tx, run.id, 'timeout'))).toBe(false);
  });

  it('a reply takes the "replied" path immediately; no reply takes the "timeout" path', async () => {
    const g = G([trig(), wait('w', 120), tag('r', 'replied'), tag('s', 'silent')], [edge('t', 'w'), edge('w', 'r', 'replied'), edge('w', 's', 'timeout')]);
    const a = await createGraph(g);
    const phone = `98${String(30_000_000 + Math.floor(Math.random() * 9_000_000))}`;
    const talker = await mkLead({ phone: `+91${phone}` }); const quiet = await mkLead(); await settle();
    expect((await runsOf(a.id)).map((r) => r.status)).toEqual(['WAITING', 'WAITING']);
    await ctx.app.get(InboundService).ingest({ tenantId: owner.tenantId, channel: { id: channelId, type: 'WHATSAPP' }, externalThreadId: `91${phone}`, contact: { name: 'Talker', phone: `+91${phone}` }, message: { type: 'TEXT', body: 'Yes I am interested', externalId: `wamid.GR${RUN}${++n}`, at: new Date() } as never, source: 'whatsapp' });
    await settle();
    const runs = await runsOf(a.id);
    const replied = runs.find((r) => r.lead_id === talker)!; const silent = runs.find((r) => r.lead_id === quiet)!;
    expect(replied.status).toBe('SUCCEEDED'); expect(await tagsOf(talker)).toEqual(['replied']);
    expect(replied.steps.find((s) => s.type === 'wait')).toMatchObject({ branch: 'replied' });
    expect(silent.status).toBe('WAITING');
    await expire(silent.id);
    expect(await tagsOf(quiet)).toEqual(['silent']);
  });

  it('a wait without a "replied" edge ignores replies and keeps waiting to the deadline', async () => {
    const a = await createGraph(G([trig(), wait('w', 90), tag('x', 'after')], [edge('t', 'w'), edge('w', 'x', 'next')]));
    const phone = `98${String(30_000_000 + Math.floor(Math.random() * 9_000_000))}`;
    const l = await mkLead({ phone: `+91${phone}` }); await settle();
    await ctx.app.get(InboundService).ingest({ tenantId: owner.tenantId, channel: { id: channelId, type: 'WHATSAPP' }, externalThreadId: `91${phone}`, contact: { name: 'Chatty', phone: `+91${phone}` }, message: { type: 'TEXT', body: 'hello', externalId: `wamid.GN${RUN}${++n}`, at: new Date() } as never, source: 'whatsapp' });
    await settle();
    expect((await runsOf(a.id))[0]!.status).toBe('WAITING'); expect(await tagsOf(l)).toEqual([]);
  });

  it('opt-out (STOP) ends waiting runs as SKIPPED, even where a reply would have resumed them', async () => {
    const a = await createGraph(G([trig(), wait('w', 120), tag('r', 'should-not-run')], [edge('t', 'w'), edge('w', 'r', 'replied')]));
    const phone = `98${String(30_000_000 + Math.floor(Math.random() * 9_000_000))}`;
    const l = await mkLead({ phone: `+91${phone}` }); await settle();
    await ctx.app.get(InboundService).ingest({ tenantId: owner.tenantId, channel: { id: channelId, type: 'WHATSAPP' }, externalThreadId: `91${phone}`, contact: { name: 'Leaver', phone: `+91${phone}` }, message: { type: 'TEXT', body: 'STOP', externalId: `wamid.GS${RUN}${++n}`, at: new Date() } as never, source: 'whatsapp' });
    await settle();
    const run = (await runsOf(a.id))[0]!;
    expect(run.status).toBe('SKIPPED'); expect(run.steps.find((s) => s.type === 'wait')).toMatchObject({ status: 'skipped', detail: 'The customer opted out' });
    expect(await tagsOf(l)).toEqual([]);
  });

  it('turning the automation off ends its waiting runs; an opt-out recorded without a message is caught at resume', async () => {
    const a = await createGraph(G([trig(), wait('w', 60), tag('x', 'late')], [edge('t', 'w'), edge('w', 'x', 'timeout')]));
    const l = await mkLead(); await settle();
    expect((await runsOf(a.id))[0]!.status).toBe('WAITING');
    expect((await ctx.http().post(`/automations/${a.id}/enable`).set(auth(owner.accessToken)).send({ enabled: false })).status).toBe(200);
    const run = (await runsOf(a.id))[0]!;
    expect(run.status).toBe('SKIPPED'); expect(run.steps.find((s) => s.type === 'wait')?.detail).toBe('The automation was turned off');
    expect(await tagsOf(l)).toEqual([]);

    const b = await createGraph(G([trig(), wait('w', 60), tag('x', 'late2')], [edge('t', 'w'), edge('w', 'x', 'timeout')]));
    const l2 = await mkLead(); await settle(); await consent(l2, 'OPTED_OUT');
    await expire((await runsOf(b.id))[0]!.id);
    const r2 = (await runsOf(b.id))[0]!;
    expect(r2.status).toBe('SKIPPED'); expect(await tagsOf(l2)).toEqual([]);
  });

  it('a run keeps the version it started with when the automation is edited during its wait', async () => {
    const a = await createGraph(G([trig(), wait('w', 60), tag('x', 'old-version')], [edge('t', 'w'), edge('w', 'x', 'timeout')]));
    const l1 = await mkLead(); await settle();
    const edit = await ctx.http().put(`/automations/${a.id}`).set(auth(owner.accessToken)).send({ name: 'Edited', cooldownMinutes: 0, expectedVersion: 1, graph: G([trig(), wait('w', 60), tag('x', 'new-version')], [edge('t', 'w'), edge('w', 'x', 'timeout')]) });
    expect(edit.status).toBe(200); expect(edit.body.version).toBe(2);
    const l2 = await mkLead(); await settle();
    const runs = await runsOf(a.id);
    expect(new Set(runs.map((r) => r.version_id)).size).toBe(2);
    for (const r of runs) await expire(r.id).catch(async () => { /* the second expire may find nothing due if already resumed */ });
    await settle();
    expect(await tagsOf(l1)).toEqual(['old-version']); expect(await tagsOf(l2)).toEqual(['new-version']);
  });

  it('cooldown counts a waiting run, so a second event for the same lead does not start another', async () => {
    const a = await createGraph(G([trig('lead.stage_changed'), wait('w', 60), tag('x', 'cool')], [edge('t', 'w'), edge('w', 'x', 'timeout')]), { cooldownMinutes: 60 });
    const l = await mkLead();
    const stages = ((await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken))).body.stages as { id: string; kind: string }[]).filter((s) => s.kind === 'OPEN');
    await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: stages[1]!.id }); await settle();
    await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: stages[2]!.id }); await settle();
    const runs = await runsOf(a.id);
    expect(runs.map((r) => r.status)).toEqual(['WAITING', 'SKIPPED']);
    expect(runs[1]!.steps[0]).toMatchObject({ type: 'gate', detail: 'cooldown' });
  });

  it('the plan and consent are re-checked after the wait: an opted-out customer gets no message', async () => {
    const a = await createGraph(G([trig(), wait('w', 30), { id: 'm', type: 'action', data: { type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] } }], [edge('t', 'w'), edge('w', 'm', 'timeout')]));
    const l = await mkLead(); await consent(l); await settle();
    await consent(l, 'OPTED_OUT'); // withdrawn while the run waited
    await expire((await runsOf(a.id))[0]!.id);
    expect((await runsOf(a.id))[0]!.status).toBe('SKIPPED');
    expect((await q(`SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1`, [l])).length).toBe(0);
  });
});

describe('crash and retry safety', () => {
  it('a failed step is retried without repeating the steps before it (no double side effects)', async () => {
    const a = await createGraph(G([trig(), task('k1', 'only once'), { id: 'm', type: 'action', data: { type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] } }, tag('z', 'done-tag')], [edge('t', 'k1'), edge('k1', 'm'), edge('m', 'z')]));
    const convos = ctx.app.get(ConversationsService); const original = convos.sendSystem.bind(convos);
    let calls = 0;
    convos.sendSystem = (async (...args: Parameters<typeof original>) => { if (++calls === 1) throw new Error('provider down'); return original(...args); }) as never;
    try {
      const l = await mkLead(); await consent(l);
      const run = await runFor(a.id, l);
      await expect(engine.execute(owner.tenantId, run.id, false)).rejects.toThrow('provider down');
      let mid = (await runsOf(a.id))[0]!;
      expect(mid.status).toBe('QUEUED'); expect(await tasksOf(l)).toEqual(['only once']);
      await engine.execute(owner.tenantId, run.id, false);
      mid = (await runsOf(a.id))[0]!;
      expect(mid.status).toBe('SUCCEEDED'); expect(mid.attempts).toBe(2);
      expect(await tasksOf(l)).toEqual(['only once']); expect(await tagsOf(l)).toEqual(['done-tag']);
      expect((await q(`SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1`, [l])).length).toBe(1);
      await engine.execute(owner.tenantId, run.id, false); // a duplicate delivery of a finished run is a no-op
      expect(await tasksOf(l)).toEqual(['only once']);
    } finally { convos.sendSystem = original as never; }
  });

  it('a branch decision is not re-made on retry, even if the lead changed in between', async () => {
    const a = await createGraph(G([trig(), branch('b', [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }]), { id: 'm', type: 'action', data: { type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] } }, tag('y', 'hot-path'), tag('n', 'cold-path')], [edge('t', 'b'), edge('b', 'm', 'yes'), edge('m', 'y'), edge('b', 'n', 'no')]));
    const convos = ctx.app.get(ConversationsService); const original = convos.sendSystem.bind(convos);
    let calls = 0;
    convos.sendSystem = (async (...args: Parameters<typeof original>) => { if (++calls === 1) throw new Error('provider down'); return original(...args); }) as never;
    try {
      const l = await mkLead(); await consent(l);
      await q(`UPDATE leads SET temperature = 'HOT' WHERE id = $1`, [l]);
      const run = await runFor(a.id, l);
      await expect(engine.execute(owner.tenantId, run.id, false)).rejects.toThrow();
      await q(`UPDATE leads SET temperature = 'COLD' WHERE id = $1`, [l]); // no longer HOT: a fresh evaluation would now go the other way
      await engine.execute(owner.tenantId, run.id, false);
      expect(await tagsOf(l)).toEqual(['hot-path']);
    } finally { convos.sendSystem = original as never; }
  });
});

describe('dry run through the graph', () => {
  it('shows the path with per-condition results and simulated waits, and previews an unsaved draft without storing it', async () => {
    const a = await createGraph(G([trig(), branch('b', [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }, { field: 'lead.location', op: 'eq', value: 'wakad' }], 'any'), wait('w', 1440), tag('y', 'yes-tag'), tag('n', 'no-tag')], [edge('t', 'b'), edge('b', 'w', 'yes'), edge('w', 'y', 'timeout'), edge('b', 'n', 'no')]), {}, false);
    const l = await mkLead({ location: 'Wakad' });
    const r = await ctx.http().post(`/automations/${a.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: l });
    expect(r.status).toBe(200);
    expect(r.body.path.map((p: { nodeId: string; outcome: string }) => `${p.nodeId}:${p.outcome}`)).toEqual(['b:yes', 'w:would_wait', 'y:would_run']);
    expect(r.body.path[0].conditions).toEqual([{ text: 'temperature is HOT', pass: false }, { text: 'location is wakad', pass: true }]);
    expect(r.body.path[1].wouldWaitMinutes).toBe(1440);
    expect(r.body.steps.map((s: { type: string }) => s.type)).toEqual(['branch', 'wait', 'add_tag']); // existing fields keep their meaning
    expect(await tagsOf(l)).toEqual([]); // no side effects
    const draft = G([trig(), tag('d', 'draft-tag')], [edge('t', 'd')]);
    const d = await ctx.http().post(`/automations/${a.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: l, graph: draft });
    expect(d.status).toBe(200); expect(d.body.path.map((p: { nodeId: string }) => p.nodeId)).toEqual(['d']);
    expect((await ctx.http().get(`/automations/${a.id}`).set(auth(owner.accessToken))).body.version).toBe(1); // not stored
    expect((await ctx.http().post(`/automations/${a.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: l, graph: { v: 1, nodes: [], edges: [] } })).status).toBe(400);
  });

  it('a legacy linear automation still reports unmet conditions with empty steps', async () => {
    const lin = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Lin dry', trigger: { type: 'lead.created' }, conditions: [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }], actions: [{ type: 'add_tag', tag: 'x' }], cooldownMinutes: 0 });
    const l = await mkLead();
    const r = await ctx.http().post(`/automations/${lin.body.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: l });
    expect(r.body).toMatchObject({ conditionsMet: false, steps: [] });
  });
});

describe('automation_versions isolation', () => {
  it('is invisible across workspaces and without a tenant, and immutable for the app role', async () => {
    const a = await createGraph(G([trig(), tag('a', 'iso')], [edge('t', 'a')]), {}, false);
    const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const c = await app.connect();
    try {
      const count = async (tenant: string | null) => {
        await c.query('BEGIN');
        if (tenant) await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
        const n = (await c.query('SELECT count(*)::int n FROM automation_versions WHERE automation_id = $1', [a.id])).rows[0].n as number;
        await c.query('ROLLBACK'); return n;
      };
      expect(await count(owner.tenantId)).toBe(1); expect(await count(other.tenantId)).toBe(0); expect(await count(null)).toBe(0);
      await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', $1, true)", [owner.tenantId]);
      await expect(c.query('UPDATE automation_versions SET version = 99 WHERE automation_id = $1', [a.id])).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK'); await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', $1, true)", [owner.tenantId]);
      await expect(c.query('DELETE FROM automation_versions WHERE automation_id = $1', [a.id])).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK'); await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', $1, true)", [other.tenantId]);
      await expect(c.query(`INSERT INTO automation_versions (tenant_id, automation_id, version, graph) VALUES ($1, $2, 7, '{}')`, [owner.tenantId, a.id])).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');
    } finally { c.release(); await app.end(); }
  });
});

describe('effectiveGraph on a stored row', () => {
  it('prefers the stored graph and lifts legacy columns otherwise', () => {
    const lin = { trigger: { type: 'lead.created' }, conditions: [], actions: [{ type: 'add_tag', tag: 'x' }] };
    expect(effectiveGraph({ ...lin, graph: null }).nodes).toHaveLength(2);
    expect(effectiveGraph({ ...lin, graph: G([trig(), tag('a', 'y'), tag('b', 'z')], [edge('t', 'a'), edge('a', 'b')]) }).nodes).toHaveLength(3);
  });
});
