import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { graphErrors, graphSchema, summarizeGraph, validateGraph } from '@leadpilot/validation';
import { INDUSTRIES } from '@leadpilot/validation';
import { InboundService } from '../src/conversations/inbound.service.js';
import { AutomationEngine } from '../src/ops/automation-engine.js';
import { ALL_AUTOMATION_TEMPLATES, AUTOMATION_TEMPLATES, GRAPH_TEMPLATES, templatesForPack } from '../src/ops/automation-templates.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { ScannersService } from '../src/ops/scanners.service.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

// ------------------------------------------------------------------------------------------------------------------------------- pure checks
const PLACEHOLDERS = new Set(['lead.name', 'lead.firstName', 'business.name', 'appointment.date', 'appointment.time', 'appointment.location', 'agent.name']);
const stringsIn = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as object).flatMap(stringsIn) : []);

describe('graph templates: definitions', () => {
  it('there are eight, with unique keys that do not collide with the linear ones', () => {
    expect(GRAPH_TEMPLATES).toHaveLength(8);
    const keys = ALL_AUTOMATION_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(AUTOMATION_TEMPLATES).toHaveLength(8); // the base eight are untouched
  });

  it('every one is a valid graph (no errors) that uses a branch or a wait, with a plain-English summary', () => {
    for (const t of GRAPH_TEMPLATES) {
      const g = graphSchema.parse(t.graph);
      expect(graphErrors(validateGraph(g)), t.key).toEqual([]);
      expect(g.nodes.some((n) => n.type === 'branch' || n.type === 'wait'), t.key).toBe(true);
      const s = summarizeGraph(g);
      expect(s.length, t.key).toBeGreaterThan(2);
      expect(s[0], t.key).toMatch(/^When /);
      expect(t.conditions, t.key).toEqual([]); // the graph is the definition
    }
  });

  it('the waits teach both exits: every wait that has a "replied" path also has a "no reply" path or ends the automation on purpose', () => {
    for (const t of GRAPH_TEMPLATES) {
      const g = graphSchema.parse(t.graph);
      for (const w of g.nodes.filter((n) => n.type === 'wait')) {
        const outs = g.edges.filter((e) => e.from === w.id).map((e) => e.label);
        expect(outs.length, `${t.key}/${w.id}`).toBeGreaterThan(0);
        if (outs.includes('replied')) expect(outs.some((l) => l === 'timeout' || l === 'next'), `${t.key}/${w.id}`).toBe(true);
      }
    }
  });

  it('required WhatsApp templates are exactly the templates the graph sends, and only known placeholders are used', () => {
    for (const t of GRAPH_TEMPLATES) {
      const g = graphSchema.parse(t.graph);
      const sent = [...new Set(g.nodes.flatMap((n) => (n.type === 'action' && n.data.type === 'send_whatsapp_template' ? [n.data.template] : [])))];
      expect([...t.requiresWhatsappTemplates].sort(), t.key).toEqual([...sent].sort());
      expect(t.trigger, t.key).toEqual(g.nodes.find((n) => n.type === 'trigger')?.data);
      for (const str of stringsIn(g)) for (const m of str.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) expect(PLACEHOLDERS.has(m[1] as string), `${t.key}: {{${m[1]}}}`).toBe(true);
    }
  });

  it('industry tags name real packs; the clinic one never asks about health; filtering per pack', () => {
    const packs = new Set(['real_estate', 'general', 'coaching', 'healthcare', 'home_services']);
    for (const t of GRAPH_TEMPLATES) for (const i of t.industries ?? []) expect(packs.has(i), `${t.key}: ${i}`).toBe(true);
    expect(INDUSTRIES.length).toBeGreaterThan(0);
    const clinic = GRAPH_TEMPLATES.find((t) => t.key === 'consultation_followup_checkin');
    expect(JSON.stringify(clinic)).not.toMatch(/symptom|diagnos|medicine|treatment|pain|prescri/i);
    const keysFor = (p: string) => templatesForPack(p).map((t) => t.key);
    const generic = GRAPH_TEMPLATES.filter((t) => !t.industries).map((t) => t.key);
    expect(generic).toHaveLength(5);
    for (const p of packs) for (const g of generic) expect(keysFor(p), `${p}/${g}`).toContain(g);
    expect(keysFor('coaching')).toContain('demo_class_enrolment_nudge');
    expect(keysFor('coaching')).not.toContain('consultation_followup_checkin');
    expect(keysFor('healthcare')).toContain('consultation_followup_checkin');
    expect(keysFor('home_services')).toContain('quote_followup_sequence');
    expect(keysFor('real_estate')).not.toContain('quote_followup_sequence');
    expect(keysFor('general')).toHaveLength(8 + 5);
    expect(keysFor('real_estate')).toHaveLength(8 + 5);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------- integration
let ctx: TestCtx; let owner$: pg.Pool; let owner: Account; let other: Account;
let relay: OutboxRelay; let engine: AutomationEngine; let scanners: ScannersService; let channelId = '';
let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await owner$.query(sql, args)).rows as T[];
const phone10 = () => `98${String(30_000_000 + Math.floor(Math.random() * 9_000_000))}`;

const mkLead = async (extra: Record<string, unknown> = {}) => {
  const r = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Tpl Lead ${++n}`, phone: `+91${phone10()}`, ...extra });
  if (r.status !== 201) throw new Error(`lead create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};
const install = async (key: string, token = owner.accessToken) => ctx.http().post('/automations/from-template').set(auth(token)).send({ templateKey: key });
const enable = async (id: string) => { const e = await ctx.http().post(`/automations/${id}/enable`).set(auth(owner.accessToken)).send({ enabled: true }); if (e.status !== 200) throw new Error(`enable failed ${JSON.stringify(e.body)}`); };
/** Installs the template (or reuses the copy an earlier test installed) and turns it on. */
const installAndEnable = async (key: string) => {
  const r = await install(key);
  let id: string;
  if (r.status === 201) id = r.body.id as string;
  else if (r.status === 409) id = (await q<{ id: string }>(`SELECT id FROM automations WHERE tenant_id = $1 AND template_key = $2`, [owner.tenantId, key]))[0]!.id;
  else throw new Error(`install failed ${r.status} ${JSON.stringify(r.body)}`);
  await enable(id); return { id };
};
type RunRow = { id: string; status: string; steps: { i: number; nodeId?: string; type: string; status: string; detail?: string; branch?: string }[]; lead_id: string; resume_at: string | null; waiting_node: string | null };
const runsOf = (automationId: string) => q<RunRow>(`SELECT id, status, steps, lead_id, resume_at, waiting_node FROM automation_runs WHERE automation_id = $1 AND status <> 'DRY_RUN' ORDER BY created_at`, [automationId]);
const tasksOf = async (leadId: string) => (await q<{ title: string }>(`SELECT title FROM tasks WHERE lead_id = $1 ORDER BY created_at`, [leadId])).map((x) => x.title);
const tagsOf = async (leadId: string) => (await q<{ name: string }>(`SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1 ORDER BY t.name`, [leadId])).map((x) => x.name);

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
    if (r) { await settle(); return (await runsOf(automationId)).find((x) => x.lead_id === leadId) as RunRow; }
    await sleep(100);
  }
  throw new Error('run was not created');
}
async function expire(runId: string) {
  await q(`UPDATE automation_runs SET resume_at = now() - interval '1 second' WHERE id = $1`, [runId]);
  expect((await scanners.scanTenant(owner.tenantId)).waitsResumed).toBeGreaterThanOrEqual(1);
  await settle();
}
const reply = async (leadPhone: string, body = 'Yes, please call me') =>
  ctx.app.get(InboundService).ingest({ tenantId: owner.tenantId, channel: { id: channelId, type: 'WHATSAPP' }, externalThreadId: leadPhone.replace('+', ''), contact: { name: 'Replier', phone: leadPhone }, message: { type: 'TEXT', body, externalId: `wamid.TG${RUN}${++n}`, at: new Date() } as never, source: 'whatsapp' });

beforeAll(async () => {
  ctx = await createTestApp();
  relay = ctx.app.get(OutboxRelay); engine = ctx.app.get(AutomationEngine); scanners = ctx.app.get(ScannersService);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'tgOwner'); other = await registerAccount(ctx, 'tgOther', 'coaching');
  const phoneId = `65${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ name: 'Template line', phoneNumberId: phoneId, wabaId: `66${phoneId.slice(2)}`, accessToken: 'EAAGtemplateTestToken123456789012', appSecret: 'template-test-secret-1234567890' });
  if (ch.status !== 201) throw new Error(`channel failed ${JSON.stringify(ch.body)}`);
  channelId = ch.body.id;
  for (const [name, preview] of [['welcome_lead', 'Hi {{1}}, welcome to {{2}}'], ['no_show_followup', 'Hi {{1}}, we missed you. Want a new time?']] as const) {
    const t = await ctx.http().post('/whatsapp/templates').set(auth(owner.accessToken)).send({ name, bodyPreview: preview });
    if (t.status !== 201) throw new Error(`template ${name} failed ${JSON.stringify(t.body)}`);
  }
});
afterEach(async () => { await q(`UPDATE automations SET enabled = false WHERE tenant_id = $1`, [owner.tenantId]); await q(`UPDATE automation_runs SET status = 'SKIPPED' WHERE tenant_id = $1 AND status = 'WAITING'`, [owner.tenantId]); await settle(); });
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('graph templates: the API', () => {
  it('lists them with graph, summary and flags, per workspace pack; installing creates a disabled graph automation', async () => {
    const list = await ctx.http().get('/automations/templates').set(auth(owner.accessToken));
    expect(list.status).toBe(200);
    const byKey = new Map((list.body.items as { key: string; graph: { v: number }; summary: string[]; branching: boolean; hasWaits: boolean; requiresWhatsappTemplates: string[]; installed: boolean }[]).map((t) => [t.key, t]));
    expect(byKey.size).toBe(8 + 5); // real estate: the eight base + five general graph templates
    for (const key of ['follow_up_no_reply', 'hot_vs_warm_new_lead', 'no_show_recovery_escalation', 'unassigned_lead_escalation', 'quiet_lead_reengage']) {
      const t = byKey.get(key); expect(t, key).toBeTruthy();
      expect(t?.graph.v).toBe(1); expect(t?.summary.length).toBeGreaterThan(2); expect(t?.installed).toBe(false);
    }
    expect(byKey.get('follow_up_no_reply')).toMatchObject({ hasWaits: true, branching: false, requiresWhatsappTemplates: ['welcome_lead'] });
    expect(byKey.get('hot_vs_warm_new_lead')).toMatchObject({ branching: true, hasWaits: false });
    expect(byKey.get('welcome_new_lead')).toMatchObject({ branching: false, hasWaits: false }); // a linear one
    expect(byKey.has('demo_class_enrolment_nudge')).toBe(false); // a coaching template

    const inst = await install('quiet_lead_reengage');
    expect(inst.status).toBe(201);
    expect(inst.body).toMatchObject({ enabled: false, templateKey: 'quiet_lead_reengage', graphAuthored: true, version: 1 });
    expect(inst.body.missingWhatsappTemplates).toEqual(['reengage_lead']); // not registered in this workspace: reported, not silently skipped
    expect(inst.body.trigger).toEqual({ type: 'lead.inactive', days: 7 });
    expect((await install('quiet_lead_reengage')).status).toBe(409);
    const v = await q<{ source: string }>(`SELECT source FROM automation_versions WHERE automation_id = $1`, [inst.body.id]);
    expect(v).toEqual([{ source: 'graph' }]);
    // a linear starter still installs as a linear automation, exactly as before
    const lin = await install('welcome_new_lead');
    expect(lin.status).toBe(201); expect(lin.body.graphAuthored).toBe(false);
    expect(lin.body.missingWhatsappTemplates).toEqual([]);
  });

  it('the legacy columns mirror the graph: exact for a straight line, trigger plus every action otherwise', async () => {
    const inst = await install('hot_vs_warm_new_lead');
    const row = (await q<{ trigger: unknown; conditions: unknown; actions: { type: string }[] }>(`SELECT trigger, conditions, actions FROM automations WHERE id = $1`, [inst.body.id]))[0]!;
    expect(row.trigger).toEqual({ type: 'lead.created' });
    expect(row.conditions).toEqual([]); // branching graph: conditions live in the graph
    expect(row.actions.map((a) => a.type).sort()).toEqual(['create_task', 'notify', 'send_whatsapp_template']);
    // a linear graph body mirrors exactly
    const g = { v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'lead.created' } }, { id: 'c', type: 'branch', data: { match: 'all', conditions: [{ field: 'lead.assigned', op: 'eq', value: false }] } }, { id: 'a1', type: 'action', data: { type: 'add_tag', tag: 'mirror' } }], edges: [{ id: 'e1', from: 't', to: 'c', label: 'next' }, { id: 'e2', from: 'c', to: 'a1', label: 'yes' }] };
    const r = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Mirror', graph: g, cooldownMinutes: 0 });
    expect(r.status).toBe(201);
    const row2 = (await q<{ conditions: unknown }>(`SELECT conditions FROM automations WHERE id = $1`, [r.body.id]))[0]!;
    expect(row2.conditions).toEqual([{ field: 'lead.assigned', op: 'eq', value: false }]);
  });

  it('industry filtering: other packs cannot see or install a pack-specific graph template', async () => {
    const co = (await ctx.http().get('/automations/templates').set(auth(other.accessToken))).body.items as { key: string }[];
    expect(co.map((t) => t.key)).toContain('demo_class_enrolment_nudge');
    expect(co.map((t) => t.key)).not.toContain('quote_followup_sequence');
    expect((await install('demo_class_enrolment_nudge')).status).toBe(404); // owner is real estate
    expect((await install('quote_followup_sequence', other.accessToken)).status).toBe(404);
    const ok = await install('demo_class_enrolment_nudge', other.accessToken);
    expect(ok.status).toBe(201); expect(ok.body.graphAuthored).toBe(true); expect(ok.body.missingWhatsappTemplates).toEqual(['enrolment_nudge']);
    expect((await ctx.http().get(`/automations/${ok.body.id}`).set(auth(owner.accessToken))).status).toBe(404); // tenant isolation
  });
});

describe('graph templates: behaviour', () => {
  it('"Fast-track hot and referred leads" takes the yes path for a referral and the no path for an ordinary lead (dry run and real run)', async () => {
    const a = await installAndEnable('hot_vs_warm_new_lead');
    const referred = await mkLead({ sourceKey: 'referral' }); const ordinary = await mkLead({ sourceKey: 'manual' });
    // dry run: crafted leads pick different paths, nothing is created
    const d1 = await ctx.http().post(`/automations/${a.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: referred });
    expect(d1.status).toBe(200);
    expect(d1.body.path.map((p: { nodeId: string; outcome: string }) => p.nodeId)).toEqual(['b1', 'a1', 'a2']);
    expect(d1.body.path[0]).toMatchObject({ outcome: 'yes' });
    const d2 = await ctx.http().post(`/automations/${a.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: ordinary });
    expect(d2.body.path.map((p: { nodeId: string }) => p.nodeId)).toEqual(['b1', 'a3']);
    expect(d2.body.path[0]).toMatchObject({ outcome: 'no' });
    // real runs
    const r1 = await runFor(a.id, referred); const r2 = await runFor(a.id, ordinary);
    expect(r1.steps.map((s) => `${s.nodeId}:${s.branch ?? s.status}`)).toEqual(['b1:yes', 'a1:done', 'a2:done']);
    expect(r2.steps[0]).toMatchObject({ nodeId: 'b1', branch: 'no' }); expect(r2.steps[1]).toMatchObject({ nodeId: 'a3' });
    expect(await tasksOf(referred)).toEqual([expect.stringContaining('Call priority lead Tpl Lead')]);
    expect(await tasksOf(ordinary)).toEqual([]);
  });

  it('"Follow up if a new lead does not reply": parks on the wait; silence creates the call task, a reply stops it', async () => {
    const a = await installAndEnable('follow_up_no_reply');
    const silentPhone = `+91${phone10()}`; const talkerPhone = `+91${phone10()}`;
    const silent = await mkLead({ phone: silentPhone }); const talker = await mkLead({ phone: talkerPhone });
    const rs = await runFor(a.id, silent); const rt = await runFor(a.id, talker);
    expect(rs.status).toBe('WAITING'); expect(rs.waiting_node).toBe('w1'); expect(rt.status).toBe('WAITING');
    expect(rs.steps[0]).toMatchObject({ nodeId: 'a1', type: 'send_whatsapp_template' }); // attempted (sent or skipped for consent: the wait follows either way)
    expect(new Date(rs.resume_at as string).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(await tasksOf(silent)).toEqual([]);
    // the customer writes back: the "replied" path is a stop
    await reply(talkerPhone); await settle();
    const after = (await runsOf(a.id)).find((r) => r.lead_id === talker)!;
    expect(['SUCCEEDED', 'SKIPPED']).toContain(after.status); // SKIPPED when the welcome send itself was skipped for lack of WhatsApp consent: nothing else ran
    expect(after.steps.find((s) => s.type === 'wait')).toMatchObject({ status: 'done', branch: 'replied' });
    expect(await tasksOf(talker)).toEqual([]);
    // silence: the deadline passes and the "no reply" path runs
    await expire(rs.id);
    const done = (await runsOf(a.id)).find((r) => r.lead_id === silent)!;
    expect(done.status).toBe('SUCCEEDED'); expect(done.steps.find((s) => s.type === 'wait')).toMatchObject({ branch: 'timeout' });
    expect(await tasksOf(silent)).toEqual([expect.stringContaining('no reply to our WhatsApp')]);
    expect((await q<{ c: number }>(`SELECT count(*)::int c FROM notifications WHERE tenant_id = $1 AND title LIKE '%has not replied in 24 hours'`, [owner.tenantId]))[0]!.c).toBeGreaterThanOrEqual(1);
  });

  it('"Assign new leads, and escalate after 2 hours": still unowned after the wait means managers are alerted', async () => {
    const a = await installAndEnable('unassigned_lead_escalation');
    const l = await mkLead();
    await q(`UPDATE leads SET assigned_membership_id = NULL WHERE id = $1`, [l]); // no owner (the creator is not auto-assigned in every setup)
    const dry = await ctx.http().post(`/automations/${a.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: l });
    expect(dry.body.path.map((p: { nodeId: string; outcome: string }) => `${p.nodeId}:${p.outcome}`)).toEqual(['b1:yes', 'a1:would_run', 'w1:would_wait', 'b2:yes', 'a2:would_run', 'a3:would_run']);
    const run = await runFor(a.id, l);
    expect(run.status).toBe('WAITING'); expect(run.waiting_node).toBe('w1');
    await expire(run.id);
    const done = (await runsOf(a.id)).find((r) => r.lead_id === l)!;
    expect(done.status).toBe('SUCCEEDED');
    const visited = done.steps.map((s) => s.nodeId);
    expect(visited).toEqual(expect.arrayContaining(['b1', 'a1', 'w1', 'b2']));
    // only when the lead is STILL unowned does it escalate (the single agent-less workspace leaves it unowned)
    const owned = (await q<{ assigned_membership_id: string | null }>(`SELECT assigned_membership_id FROM leads WHERE id = $1`, [l]))[0]!.assigned_membership_id;
    expect(done.steps.find((s) => s.nodeId === 'b2')?.branch).toBe(owned ? 'no' : 'yes');
    expect((await tasksOf(l)).some((t) => t.startsWith('Assign an owner to'))).toBe(!owned);
  });

  it('"Win back no-shows": a reply takes the re-book path, silence escalates to managers', async () => {
    const a = await installAndEnable('no_show_recovery_escalation');
    // drive the template with a synthetic no-show event for two leads
    const quietPhone = `+91${phone10()}`; const chattyPhone = `+91${phone10()}`;
    const quiet = await mkLead({ phone: quietPhone }); const chatty = await mkLead({ phone: chattyPhone });
    const db = ctx.app.get((await import('../src/db/db.module.js')).DbService);
    const outbox = ctx.app.get((await import('../src/ops/outbox.service.js')).OutboxService);
    for (const l of [quiet, chatty]) await db.tenantTx({ tenantId: owner.tenantId }, (tx) => outbox.emit(tx, owner.tenantId, 'appointment.no_show', { leadId: l, appointmentId: '00000000-0000-4000-8000-000000000001' }));
    const rq = await runFor(a.id, quiet); const rc = await runFor(a.id, chatty);
    expect(rq.status).toBe('WAITING'); expect(rc.status).toBe('WAITING');
    await reply(chattyPhone, 'Sorry, I was stuck. Tomorrow works.'); await settle();
    expect(await tasksOf(chatty)).toEqual([expect.stringContaining('replied: re-book')]);
    await expire(rq.id);
    expect(await tasksOf(quiet)).toEqual([expect.stringContaining('Call Tpl Lead')]);
    expect((await q<{ c: number }>(`SELECT count(*)::int c FROM notifications WHERE tenant_id = $1 AND title LIKE '%missed an appointment and has not replied'`, [owner.tenantId]))[0]!.c).toBeGreaterThanOrEqual(1);
  });

  it('opt-out ends a template run that is waiting, and the "no reply" path never runs for someone who opted out', async () => {
    const a = await installAndEnable('quiet_lead_reengage');
    const p = `+91${phone10()}`; const l = await mkLead({ phone: p });
    const db = ctx.app.get((await import('../src/db/db.module.js')).DbService);
    const outbox = ctx.app.get((await import('../src/ops/outbox.service.js')).OutboxService);
    await db.tenantTx({ tenantId: owner.tenantId }, (tx) => outbox.emit(tx, owner.tenantId, 'lead.inactive', { leadId: l, days: 7 }));
    const run = await runFor(a.id, l);
    expect(run.status).toBe('WAITING');
    await reply(p, 'STOP'); await settle();
    const after = (await runsOf(a.id)).find((r) => r.lead_id === l)!;
    expect(after.status).toBe('SKIPPED');
    expect(await tagsOf(l)).toEqual([]); expect(await tasksOf(l)).toEqual([]);
  });
});

describe('one unreadable automation does not stop the others', () => {
  it('events and scans keep working for the workspace while the broken definition is skipped', async () => {
    const good = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Robust good', cooldownMinutes: 0, graph: { v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'lead.created' } }, { id: 'a', type: 'action', data: { type: 'add_tag', tag: 'robust-ok' } }], edges: [{ id: 'e', from: 't', to: 'a', label: 'next' }] } });
    const bad = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Robust bad', cooldownMinutes: 0, graph: { v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'lead.created' } }, { id: 'a', type: 'action', data: { type: 'add_tag', tag: 'robust-bad' } }], edges: [{ id: 'e', from: 't', to: 'a', label: 'next' }] } });
    expect(good.status).toBe(201); expect(bad.status).toBe(201);
    await enable(good.body.id); await enable(bad.body.id);
    // simulate a definition that can no longer be read (manual edit, a future schema change)
    await q(`UPDATE automations SET graph = '{"v":1,"nodes":"not-a-list","edges":[]}'::jsonb WHERE id = $1`, [bad.body.id]);
    const l = await mkLead();
    const run = await runFor(good.body.id, l);
    expect(run.status).toBe('SUCCEEDED');
    expect(await tagsOf(l)).toEqual(['robust-ok']);
    expect(await runsOf(bad.body.id)).toEqual([]); // skipped, not run, not crashed
    await expect(scanners.scanTenant(owner.tenantId)).resolves.toBeTruthy();
    await q(`UPDATE automations SET enabled = false WHERE id = $1`, [bad.body.id]);
  });
});
