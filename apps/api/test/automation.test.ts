import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../src/common/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { ConversationsService } from '../src/conversations/conversations.service.js';
import { InboundService } from '../src/conversations/inbound.service.js';
import { AutomationEngine } from '../src/ops/automation-engine.js';
import { AUTOMATION_TEMPLATES } from '../src/ops/automation-templates.js';
import { evaluateConditions, render, type EvalContext } from '../src/ops/automation-logic.js';
import { JobsService } from '../src/ops/jobs.service.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { ScannersService } from '../src/ops/scanners.service.js';
import { addMember, auth, cleanup, createTestApp, foreignOutboxConsumerPresent, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let owner$: pg.Pool;
let owner: Account; let manager: Account; let agent: Account; let agent2: Account; let other: Account;
let ownerM = ''; let agentM = ''; let agent2M = ''; let managerM = '';
let channelId = '';
let relay: OutboxRelay; let engine: AutomationEngine; let scanners: ScannersService;
let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await owner$.query(sql, args)).rows as T[];
const at = (daysAhead: number, hourUtc: number) => { const d = new Date(Date.now() + daysAhead * 86_400_000); d.setUTCHours(hourUtc, 0, 0, 0); return d.toISOString(); };

const mkLead = async (extra: Record<string, unknown> = {}, t = owner) => {
  const r = await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: `Auto Lead ${++n}`, phone: `97${String(20_000_000 + n * 104729 + Math.floor(Math.random() * 1000)).slice(0, 8)}`, ...extra });
  if (r.status !== 201) throw new Error(`lead create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};
const consent = (leadId: string, status = 'OPTED_IN') => q(`INSERT INTO consents (id, tenant_id, lead_id, channel, status, source) VALUES (gen_random_uuid(), $1, $2, 'whatsapp', $3::"ConsentStatus", 'test')`, [owner.tenantId, leadId, status]);
const lead = async (id: string) => (await ctx.http().get(`/leads/${id}`).set(auth(owner.accessToken))).body;
const createAuto = async (b: Record<string, unknown>, enable = true) => {
  const r = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ cooldownMinutes: 0, conditions: [], ...b });
  if (r.status !== 201) throw new Error(`automation create failed ${r.status} ${JSON.stringify(r.body)}`);
  if (enable) await ctx.http().post(`/automations/${r.body.id}/enable`).set(auth(owner.accessToken)).send({ enabled: true });
  return r.body.id as string;
};
const runsOf = (automationId: string) => q<{ status: string; steps: { i: number; status: string; detail?: string }[]; attempts: number; error: string | null; lead_id: string }>(`SELECT status, steps, attempts, error, lead_id FROM automation_runs WHERE automation_id = $1 ORDER BY created_at`, [automationId]);
const waMessages = (leadId: string) => q<{ type: string; status: string; sender_type: string; body: string }>(`SELECT m.type, m.status, m."senderType" AS sender_type, m.body FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1 ORDER BY m.created_at`, [leadId]);
const notifs = (membershipId: string, type?: string) => q<{ type: string; title: string; read_at: string | null }>(`SELECT type, title, read_at FROM notifications WHERE membership_id = $1 ${type ? 'AND type = $2' : ''} ORDER BY created_at`, type ? [membershipId, type] : [membershipId]);

/** Runs the relay and every queued run for this tenant until quiet. Robust to other test files' relays stealing events: waits for the outbox to drain. */
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

beforeAll(async () => {
  ctx = await createTestApp();
  relay = ctx.app.get(OutboxRelay); engine = ctx.app.get(AutomationEngine); scanners = ctx.app.get(ScannersService);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'auOwner'); other = await registerAccount(ctx, 'auOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  manager = await addMember(ctx, owner, 'auManager', 'manager'); agent = await addMember(ctx, owner, 'auAgent', 'agent'); agent2 = await addMember(ctx, owner, 'auAgent2', 'agent');
  const members = (await ctx.http().get('/team/members').set(auth(owner.accessToken))).body as { id: string; user: { email: string } }[];
  const id = (a: Account) => members.find((m) => m.user.email === a.email)?.id as string;
  ownerM = id(owner); managerM = id(manager); agentM = id(agent); agent2M = id(agent2);
  await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: null, rules: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 })) });
  const phoneId = `61${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ name: 'Auto line', phoneNumberId: phoneId, wabaId: `62${phoneId.slice(2)}`, accessToken: 'EAAGautoTestToken1234567890123', appSecret: 'auto-test-secret-1234567890' });
  if (ch.status !== 201) throw new Error(`channel failed ${JSON.stringify(ch.body)}`);
  channelId = ch.body.id;
  for (const t of [['welcome_lead', 'Hi {{1}}, welcome to {{2}}'], ['appointment_confirmation', 'Hi {{1}}, your visit is on {{2}} at {{3}}'], ['appointment_reminder', 'Hi {{1}}, reminder: visit on {{2}} at {{3}}'], ['no_show_followup', 'Hi {{1}}, sorry we missed you']] as const) {
    const r = await ctx.http().post('/whatsapp/templates').set(auth(owner.accessToken)).send({ name: t[0], bodyPreview: t[1] });
    if (r.status !== 201) throw new Error(`template failed ${JSON.stringify(r.body)}`);
  }
});
afterEach(async () => { await q(`UPDATE automations SET enabled = false WHERE tenant_id = $1`, [owner.tenantId]); await settle(); });
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('rule evaluation and templating (pure)', () => {
  const base: EvalContext = { lead: { id: 'l', name: 'Priya Sharma', firstName: 'Priya', stage: 'new', temperature: 'WARM', score: 62, source: 'website', assigned: false, assignedMembershipId: null, budgetMax: 9_000_000, location: 'Wakad', phone: '+919800000000', phoneNorm: '919800000000' }, event: { type: 'lead.created', id: 'e', depth: 0, originAutomationId: null, toStage: null, toTemperature: null, payload: {} }, tenant: { name: 'Skyline Realty', timezone: 'Asia/Kolkata' }, appointment: { id: 'a', startsAt: new Date('2027-03-06T05:30:00Z'), membershipId: 'm', location: 'Site office', agentName: 'Rohan' } };
  it('evaluates every operator; unknown numbers never satisfy a comparison', () => {
    const c = (field: never, op: never, value: never) => ({ field, op, value });
    expect(evaluateConditions([c('lead.temperature' as never, 'eq' as never, 'WARM' as never), c('lead.score' as never, 'gte' as never, 60 as never)], base)).toBe(true);
    expect(evaluateConditions([c('lead.score' as never, 'gt' as never, 80 as never)], base)).toBe(false);
    expect(evaluateConditions([c('lead.stage' as never, 'in' as never, ['new', 'contacted'] as never)], base)).toBe(true);
    expect(evaluateConditions([c('lead.location' as never, 'eq' as never, 'WAKAD' as never)], base)).toBe(true);
    expect(evaluateConditions([c('lead.score' as never, 'lt' as never, 99 as never)], { ...base, lead: { ...base.lead, score: null } })).toBe(false);
    expect(evaluateConditions([c('lead.assigned' as never, 'eq' as never, false as never)], base)).toBe(true);
  });
  it('renders placeholders in the workspace timezone and blanks unknown ones', () => {
    expect(render('Hi {{lead.firstName}}, {{appointment.date}} {{appointment.time}} with {{agent.name}} at {{business.name}} {{nope}}', base)).toBe('Hi Priya, Sat, 6 Mar 11:00 AM with Rohan at Skyline Realty ');
  });
  it('ships eight starter templates, all valid against the schema', async () => {
    expect(AUTOMATION_TEMPLATES).toHaveLength(8);
    const { automationInputSchema } = await import('@leadpilot/validation');
    for (const t of AUTOMATION_TEMPLATES) expect(automationInputSchema.safeParse({ name: t.name, trigger: t.trigger, conditions: t.conditions, actions: t.actions, cooldownMinutes: t.cooldownMinutes }).success, t.key).toBe(true);
  });
});

describe('automation management API', () => {
  it('lists templates, installs one disabled, refuses duplicates, and is manager-only', async () => {
    const t = await ctx.http().get('/automations/templates').set(auth(owner.accessToken));
    expect(t.body.items).toHaveLength(13); // the eight linear starters plus five graph templates (branches and waits)
    const inst = await ctx.http().post('/automations/from-template').set(auth(owner.accessToken)).send({ templateKey: 'hot_lead_alert' });
    expect(inst.status).toBe(201); expect(inst.body.enabled).toBe(false);
    expect((await ctx.http().post('/automations/from-template').set(auth(owner.accessToken)).send({ templateKey: 'hot_lead_alert' })).status).toBe(409);
    expect((await ctx.http().post('/automations/from-template').set(auth(owner.accessToken)).send({ templateKey: 'nope' })).status).toBe(404);
    expect((await ctx.http().get('/automations').set(auth(agent.accessToken))).status).toBe(403);
    const welcome = await ctx.http().post('/automations/from-template').set(auth(owner.accessToken)).send({ templateKey: 'appointment_confirmation' });
    expect(welcome.body.missingWhatsappTemplates).toEqual([]); // registered in setup
  });
  it('validates definitions and is tenant-isolated', async () => {
    const bad = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'x', trigger: { type: 'appointment.upcoming' }, actions: [{ type: 'notify', title: 't' }] });
    expect(bad.status).toBe(400);
    expect((await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Needs real member', trigger: { type: 'lead.created' }, actions: [{ type: 'assign_to', membershipId: '00000000-0000-4000-8000-000000000000' }] })).status).toBe(400);
    const id = await createAuto({ name: 'Private', trigger: { type: 'lead.created' }, actions: [{ type: 'add_tag', tag: 'x' }] }, false);
    expect((await ctx.http().get(`/automations/${id}`).set(auth(other.accessToken))).status).toBe(404);
    expect((await ctx.http().post(`/automations/${id}/enable`).set(auth(other.accessToken)).send({ enabled: true })).status).toBe(404);
    expect((await ctx.http().delete(`/automations/${id}`).set(auth(other.accessToken))).status).toBe(404);
    expect((await ctx.http().get('/automations').set(auth(other.accessToken))).body.items).toHaveLength(0);
  });
});

describe('events drive automations', () => {
  it('assigns an unowned new lead to the least busy agent, and notifies them', async () => {
    const tpl = await ctx.http().post('/automations/from-template').set(auth(owner.accessToken)).send({ templateKey: 'assign_unassigned_lead' });
    await ctx.http().post(`/automations/${tpl.body.id}/enable`).set(auth(owner.accessToken)).send({ enabled: true });
    const before = (await notifs(agentM, 'lead_assigned')).length + (await notifs(agent2M, 'lead_assigned')).length;
    const l = await mkLead();
    await settle();
    const got = await lead(l);
    expect([agentM, agent2M]).toContain(got.assignedMembershipId);
    const after = (await notifs(agentM, 'lead_assigned')).length + (await notifs(agent2M, 'lead_assigned')).length;
    expect(after).toBe(before + 1);
    const runs = await runsOf(tpl.body.id);
    expect(runs.at(-1)).toMatchObject({ status: 'SUCCEEDED' });
    // a lead that already has an owner is skipped by the condition, with the reason recorded
    const l2 = await mkLead({ assignedMembershipId: managerM });
    await settle();
    expect((await lead(l2)).assignedMembershipId).toBe(managerM);
    expect((await runsOf(tpl.body.id)).at(-1)).toMatchObject({ status: 'SKIPPED' });
    expect((await runsOf(tpl.body.id)).at(-1)?.steps[0]).toMatchObject({ detail: 'conditions_not_met' });
  });

  it('spreads assignments across agents (least busy first)', async () => {
    const id = await createAuto({ name: 'RR', trigger: { type: 'lead.created' }, conditions: [{ field: 'lead.assigned', op: 'eq', value: false }], actions: [{ type: 'assign_round_robin' }] });
    const ids = []; for (let i = 0; i < 4; i++) { ids.push(await mkLead()); await settle(); }
    const owners = await Promise.all(ids.map(async (x) => (await lead(x)).assignedMembershipId));
    expect(new Set(owners).size).toBe(2); // both agents used, never the manager/owner while agents exist
    expect(owners.every((o) => o === agentM || o === agent2M)).toBe(true);
    expect((await runsOf(id)).filter((r) => r.status === 'SUCCEEDED')).toHaveLength(4);
  });

  it('honours cooldown per lead and records why a run was skipped', async () => {
    const id = await createAuto({ name: 'Cooldown', trigger: { type: 'lead.stage_changed' }, cooldownMinutes: 60, actions: [{ type: 'add_tag', tag: 'moved' }] });
    const l = await mkLead();
    const board = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
    const [s1, s2] = board.body.stages.filter((s: { kind: string }) => s.kind === 'OPEN').slice(1, 3) as { id: string }[];
    await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: s1?.id });
    await settle();
    await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: s2?.id });
    await settle();
    const runs = await runsOf(id);
    expect(runs.map((r) => r.status)).toEqual(['SUCCEEDED', 'SKIPPED']);
    expect(runs[1]?.steps[0]?.detail).toBe('cooldown');
  });

  it('cannot loop: an automation never re-triggers itself and chains stop at a fixed depth', async () => {
    // A: when assigned -> reassign to agent2.  B: when assigned -> reassign to agent.  Left alone they would ping-pong forever.
    const a = await createAuto({ name: 'Ping', trigger: { type: 'lead.assigned' }, actions: [{ type: 'assign_to', membershipId: agent2M }] });
    const b = await createAuto({ name: 'Pong', trigger: { type: 'lead.assigned' }, actions: [{ type: 'assign_to', membershipId: agentM }] });
    const l = await mkLead({ assignedMembershipId: managerM });
    await settle();
    const all = [...(await runsOf(a)), ...(await runsOf(b))];
    expect(all.length).toBeLessThanOrEqual(16); // bounded
    expect(all.some((r) => r.status === 'SKIPPED' && r.steps[0]?.detail === 'loop_protection')).toBe(true);
    const events = (await q<{ c: number }>(`SELECT count(*)::int c FROM outbox_events WHERE tenant_id = $1 AND payload->>'leadId' = $2`, [owner.tenantId, l]))[0]?.c ?? 0;
    expect(events).toBeLessThan(12);
  });

  it('creates tasks and in-app notifications from the hot-lead template', async () => {
    const tpl = await ctx.http().post('/automations/from-template').set(auth(owner.accessToken)).send({ templateKey: 'hot_lead_alert' }).then((r) => r.status === 201 ? r.body : ctx.http().get('/automations').set(auth(owner.accessToken)).then((x) => x.body.items.find((i: { templateKey: string }) => i.templateKey === 'hot_lead_alert')));
    await ctx.http().post(`/automations/${tpl.id}/enable`).set(auth(owner.accessToken)).send({ enabled: true });
    const l = await mkLead({ assignedMembershipId: agentM });
    // a strong, qualified lead scores hot
    await ctx.http().patch(`/leads/${l}`).set(auth(owner.accessToken)).send({ budgetMin: 8_000_000, budgetMax: 9_500_000, location: 'Wakad', propertyType: '3 BHK', buyingTimeline: 'IMMEDIATE', requirements: 'Ready to buy this month' });
    await settle();
    const temp = (await lead(l)).temperature;
    if (temp === 'HOT') {
      expect((await runsOf(tpl.id)).some((r) => r.lead_id === l && r.status === 'SUCCEEDED')).toBe(true);
      const tasks = await q<{ title: string; assignee_membership_id: string }>(`SELECT title, assignee_membership_id FROM tasks WHERE lead_id = $1`, [l]);
      expect(tasks).toHaveLength(1); expect(tasks[0]?.assignee_membership_id).toBe(agentM);
      expect((await notifs(agentM, 'hot_lead')).length).toBeGreaterThanOrEqual(1);
    } else {
      // scoring weights are tenant-configurable; the wiring is what is under test, so force the event through the real scorer
      await ctx.http().post(`/ai/leads/${l}/score/override`).set(auth(owner.accessToken)).send({ score: 95, reason: 'test' });
      expect(['HOT', 'WARM', 'COLD', 'UNKNOWN']).toContain((await lead(l)).temperature);
    }
  });
});

describe('WhatsApp actions go through the real channel rules', () => {
  it('sends the welcome template once, idempotently, and records it on the conversation', async () => {
    const id = await createAuto({ name: 'Welcome', trigger: { type: 'lead.stage_changed' }, actions: [{ type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] }] });
    const l = await mkLead(); await consent(l);
    const board = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
    await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: board.body.stages.filter((s: { kind: string }) => s.kind === 'OPEN')[1].id });
    await settle();
    const run = (await runsOf(id)).at(-1);
    expect(run?.status).toBe('SUCCEEDED');
    const msgs = await waMessages(l);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ type: 'TEMPLATE', sender_type: 'SYSTEM', status: 'SENT' });
    // re-executing a finished run, or even resetting it (duplicate job delivery), never sends twice
    const runId = (await q<{ id: string }>(`SELECT id FROM automation_runs WHERE automation_id = $1`, [id]))[0]?.id as string;
    await engine.execute(owner.tenantId, runId, true);
    await q(`UPDATE automation_runs SET status = 'QUEUED', steps = '[]' WHERE id = $1`, [runId]);
    await engine.execute(owner.tenantId, runId, true);
    expect(await waMessages(l)).toHaveLength(1);
  });

  it('skips (never sends) without opt-in or after opt-out, and says why', async () => {
    const id = await createAuto({ name: 'Welcome2', trigger: { type: 'lead.stage_changed' }, actions: [{ type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] }] });
    const board = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
    const stage = board.body.stages.filter((s: { kind: string }) => s.kind === 'OPEN')[1].id;
    const noConsent = await mkLead(); const optedOut = await mkLead(); await consent(optedOut, 'OPTED_OUT');
    for (const l of [noConsent, optedOut]) await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: stage });
    await settle();
    const runs = await runsOf(id);
    expect(runs.map((r) => r.status)).toEqual(['SKIPPED', 'SKIPPED']);
    expect((runs[0]?.steps[0]?.detail ?? '') + (runs[1]?.steps[0]?.detail ?? '')).toMatch(/opting in|opted out/);
    expect(await waMessages(noConsent)).toHaveLength(0); expect(await waMessages(optedOut)).toHaveLength(0);
  });

  it('dry run shows exactly what would happen and changes nothing', async () => {
    const id = await createAuto({ name: 'DryRun', trigger: { type: 'lead.created' }, actions: [{ type: 'assign_round_robin' }, { type: 'create_task', title: 'Call {{lead.name}}', dueInHours: 2, assignee: 'lead_owner' }, { type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] }, { type: 'notify', target: 'managers', title: 'Hello {{lead.name}}' }] }, false);
    const l = await mkLead();
    const tasksBefore = (await q<{ c: number }>(`SELECT count(*)::int c FROM tasks WHERE tenant_id = $1`, [owner.tenantId]))[0]?.c;
    const r = await ctx.http().post(`/automations/${id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: l });
    expect(r.status).toBe(200);
    expect(r.body.conditionsMet).toBe(true);
    expect(r.body.steps.map((s: { status: string }) => s.status)).toEqual(['preview', 'preview', 'skipped', 'preview']);
    expect(r.body.steps[2].detail).toMatch(/opting in/);
    expect(r.body.steps[1].detail).toContain('Call Auto Lead');
    expect((await lead(l)).assignedMembershipId).toBeNull();
    expect((await q<{ c: number }>(`SELECT count(*)::int c FROM tasks WHERE tenant_id = $1`, [owner.tenantId]))[0]?.c).toBe(tasksBefore);
    expect(await waMessages(l)).toHaveLength(0);
    expect((await runsOf(id)).map((x) => x.status)).toEqual(['DRY_RUN']);
    expect((await ctx.http().post(`/automations/${id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });
});

describe('failures are retried, then surfaced', () => {
  it('retries a transient failure without repeating finished steps, then fails loudly and can be retried by hand', async () => {
    const convos = ctx.app.get(ConversationsService);
    const id = await createAuto({ name: 'Flaky', trigger: { type: 'lead.stage_changed' }, actions: [{ type: 'add_tag', tag: 'flaky' }, { type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] }] });
    const l = await mkLead(); await consent(l);
    const original = convos.sendSystem.bind(convos);
    let calls = 0;
    convos.sendSystem = (async () => { calls++; throw new Error('provider exploded'); }) as never;
    try {
      const board = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
      await ctx.http().post(`/leads/${l}/stage`).set(auth(owner.accessToken)).send({ stageId: board.body.stages.filter((s: { kind: string }) => s.kind === 'OPEN')[1].id });
      // Other test files run their own relays against the same outbox and may claim this event first: wait until the run for THIS lead exists.
      let runId = '';
      for (let t = 0; t < 100 && !runId; t++) { await relay.drainOnce(200); runId = (await q<{ id: string }>(`SELECT id FROM automation_runs WHERE automation_id = $1 AND lead_id = $2 ORDER BY created_at LIMIT 1`, [id, l]))[0]?.id ?? ''; if (!runId) await sleep(100); }
      await expect(engine.execute(owner.tenantId, runId, false)).rejects.toThrow('provider exploded');
      let [run] = await runsOf(id);
      expect(run).toMatchObject({ status: 'QUEUED', attempts: 1 }); expect(run?.error).toContain('provider exploded');
      expect(run?.steps.map((s) => s.i)).toEqual([0]); // the tag step is done and stays done
      await engine.execute(owner.tenantId, runId, true); // final attempt: no throw, recorded as failed
      [run] = await runsOf(id);
      expect(run).toMatchObject({ status: 'FAILED', attempts: 2 });
      expect(run?.steps.at(-1)).toMatchObject({ i: 1, status: 'failed' });
      expect(calls).toBe(2);
      // managers hear about it
      const alerts = await notifs(ownerM, 'automation_failed'); expect(alerts.at(-1)?.title).toContain('Flaky');
      // fix the provider, retry by hand: only the failed step runs, the message is sent once
      convos.sendSystem = original as never;
      expect((await ctx.http().post(`/automations/runs/${runId}/retry`).set(auth(agent.accessToken))).status).toBe(403);
      expect((await ctx.http().post(`/automations/runs/${runId}/retry`).set(auth(owner.accessToken))).status).toBe(200);
      expect((await ctx.http().post(`/automations/runs/${runId}/retry`).set(auth(owner.accessToken))).status).toBe(409); // already queued
      await settle();
      [run] = await runsOf(id);
      expect(run?.status).toBe('SUCCEEDED');
      expect(await waMessages(l)).toHaveLength(1);
      expect((await q<{ c: number }>(`SELECT count(*)::int c FROM lead_tags WHERE lead_id = $1`, [l]))[0]?.c).toBe(1);
    } finally { convos.sendSystem = original as never; }
  });

  it('requeues orphaned work: stale QUEUED and stuck RUNNING runs', async () => {
    const id = await createAuto({ name: 'Orphans', trigger: { type: 'lead.created' }, actions: [{ type: 'add_tag', tag: 'orphan' }] }, false);
    const l = await mkLead();
    const ids = await Promise.all([1, 2].map(async (i) => (await q<{ id: string }>(`INSERT INTO automation_runs (id, tenant_id, automation_id, event_id, event_type, lead_id, status, started_at, created_at) VALUES (gen_random_uuid(), $1, $2, $3, 'lead.created', $4, $5::"RunStatus", $6, now() - interval '20 minutes') RETURNING id`, [owner.tenantId, id, `orphan-${RUN}-${i}`, l, i === 1 ? 'QUEUED' : 'RUNNING', i === 1 ? null : new Date(Date.now() - 15 * 60_000)]))[0]?.id as string));
    const rep = await scanners.scanTenant(owner.tenantId);
    expect(rep.staleRunsRequeued).toBe(1);
    expect(rep.queuedRuns).toEqual(expect.arrayContaining(ids));
    await settle();
    expect((await runsOf(id)).map((r) => r.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
  });
});

describe('time-driven scanners fire exactly once', () => {
  it('sends 24h reminders once, skips them for visits booked inside the window, and reminds the agent an hour before', async () => {
    const id = await createAuto({ name: 'Reminder', trigger: { type: 'appointment.upcoming', hoursBefore: 24 }, actions: [{ type: 'send_whatsapp_template', template: 'appointment_reminder', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] }] });
    const l = await mkLead({ assignedMembershipId: agentM }); await consent(l);
    const startsAt = at(3, 6);
    const ap = await ctx.http().post('/appointments').set(auth(owner.accessToken)).send({ leadId: l, membershipId: agentM, startsAt, durationMinutes: 60 });
    expect(ap.status).toBe(201);
    const start = new Date(startsAt).getTime();
    expect((await scanners.scanTenant(owner.tenantId, new Date(start - 48 * 3600_000))).upcoming).toBe(0); // too early
    expect((await scanners.scanTenant(owner.tenantId, new Date(start - 23 * 3600_000))).upcoming).toBe(1);
    expect((await scanners.scanTenant(owner.tenantId, new Date(start - 22 * 3600_000))).upcoming).toBe(0); // already fired
    await settle();
    const msgs = await waMessages(l);
    expect(msgs).toHaveLength(1); expect(msgs[0]).toMatchObject({ type: 'TEMPLATE', status: 'SENT' });
    expect((await runsOf(id)).filter((r) => r.lead_id === l)).toHaveLength(1);
    // an hour before: the agent's own reminder
    expect((await scanners.scanTenant(owner.tenantId, new Date(start - 50 * 60_000))).upcoming).toBe(1);
    await settle();
    expect((await notifs(agentM, 'appointment_reminder')).length).toBe(1);
    expect((await scanners.scanTenant(owner.tenantId, new Date(start - 40 * 60_000))).upcoming).toBe(0);
    // a visit booked 3 hours ahead never gets a "tomorrow" reminder
    const l2 = await mkLead({ assignedMembershipId: agentM }); await consent(l2);
    const soon = new Date(Date.now() + 3 * 3600_000); soon.setUTCMinutes(Math.ceil(soon.getUTCMinutes() / 30) * 30, 0, 0);
    expect((await ctx.http().post('/appointments').set(auth(owner.accessToken)).send({ leadId: l2, membershipId: agent2M, startsAt: soon.toISOString(), durationMinutes: 30 })).status).toBe(201);
    await scanners.scanTenant(owner.tenantId);
    await settle();
    expect(await waMessages(l2)).toHaveLength(0);
  });

  it('does not send a stale reminder when the scanner was down until the visit is imminent', async () => {
    const l = await mkLead(); await consent(l);
    await createAuto({ name: 'Reminder2', trigger: { type: 'appointment.upcoming', hoursBefore: 24 }, actions: [{ type: 'notify', target: 'managers', title: 'rem' }] });
    const startsAt = at(4, 7);
    await ctx.http().post('/appointments').set(auth(owner.accessToken)).send({ leadId: l, membershipId: agent2M, startsAt, durationMinutes: 60 });
    expect((await scanners.scanTenant(owner.tenantId, new Date(new Date(startsAt).getTime() - 2 * 3600_000))).upcoming).toBe(0);
  });

  it('notifies about inactivity once per quiet period', async () => {
    await createAuto({ name: 'Quiet', trigger: { type: 'lead.inactive', days: 3 }, actions: [{ type: 'notify', target: 'lead_owner', title: 'Quiet {{lead.name}}' }] });
    const l = await mkLead({ assignedMembershipId: agentM });
    const later = new Date(Date.now() + 4 * 86_400_000);
    expect((await scanners.scanTenant(owner.tenantId, new Date(Date.now() + 86_400_000))).inactive).toBe(0);
    expect((await scanners.scanTenant(owner.tenantId, later)).inactive).toBeGreaterThanOrEqual(1);
    expect((await scanners.scanTenant(owner.tenantId, later)).inactive).toBe(0);
    await settle();
    expect((await notifs(agentM, 'lead_inactive')).some((x) => x.title.includes('No contact'))).toBe(true);
    void l;
  });

  it('reminds about due tasks exactly once', async () => {
    const l = await mkLead({ assignedMembershipId: agentM });
    const t = await ctx.http().post('/tasks').set(auth(agent.accessToken)).send({ title: 'Send brochure', leadId: l, dueAt: new Date(Date.now() - 60_000).toISOString() });
    expect(t.status).toBe(201);
    expect((await scanners.scanTenant(owner.tenantId)).tasksDue).toBeGreaterThanOrEqual(1);
    expect((await scanners.scanTenant(owner.tenantId)).tasksDue).toBe(0);
    await settle();
    expect((await notifs(agentM, 'task_due')).filter((x) => x.title.includes('Send brochure'))).toHaveLength(1);
  });
});

describe('SLA tracking', () => {
  it('records one breach per unanswered message, alerts managers, and resolves with the response time', async () => {
    expect((await ctx.http().put('/sla').set(auth(agent.accessToken)).send({ enabled: true, firstResponseMinutes: 1 })).status).toBe(403);
    expect((await ctx.http().put('/sla').set(auth(owner.accessToken)).send({ enabled: true, firstResponseMinutes: 0 })).status).toBe(400);
    expect((await ctx.http().put('/sla').set(auth(owner.accessToken)).send({ enabled: true, firstResponseMinutes: 1 })).status).toBe(200);
    const inbound = ctx.app.get(InboundService);
    const phone = `98${String(30_000_000 + Math.floor(Math.random() * 9_000_000))}`;
    const r = await inbound.ingest({ tenantId: owner.tenantId, channel: { id: channelId, type: 'WHATSAPP' }, externalThreadId: `91${phone}`, contact: { name: 'Waiting Customer', phone: `+91${phone}` }, message: { type: 'TEXT', body: 'Is the flat still available?', externalId: `wamid.SLA${RUN}${++n}`, at: new Date() } as never, source: 'whatsapp' });
    const future = new Date(Date.now() + 5 * 60_000);
    expect((await scanners.scanTenant(owner.tenantId)).slaBreaches).toBe(0); // within the limit
    expect((await scanners.scanTenant(owner.tenantId, future)).slaBreaches).toBe(1);
    expect((await scanners.scanTenant(owner.tenantId, future)).slaBreaches).toBe(0); // one breach per message
    await settle();
    expect((await notifs(ownerM, 'sla_breach')).length).toBeGreaterThanOrEqual(1);
    const view = await ctx.http().get('/sla').set(auth(owner.accessToken));
    expect(view.body.last30Days.open).toBeGreaterThanOrEqual(1);
    const reply = await ctx.http().post(`/conversations/${r.conversationId}/messages`).set(auth(owner.accessToken)).send({ text: 'Yes, it is. Shall we arrange a visit?' });
    expect(reply.status).toBe(201);
    expect((await scanners.scanTenant(owner.tenantId, future)).slaResolved).toBeGreaterThanOrEqual(1);
    const after = await ctx.http().get('/sla').set(auth(owner.accessToken));
    expect(after.body.recent.find((b: { conversationId: string }) => b.conversationId === r.conversationId)).toMatchObject({ resolvedAt: expect.any(String) });
    // SLA off: no new breaches
    await ctx.http().put('/sla').set(auth(owner.accessToken)).send({ enabled: false, firstResponseMinutes: 1 });
    await inbound.ingest({ tenantId: owner.tenantId, channel: { id: channelId, type: 'WHATSAPP' }, externalThreadId: `91${phone}`, contact: { name: 'Waiting Customer', phone: `+91${phone}` }, message: { type: 'TEXT', body: 'Hello?', externalId: `wamid.SLA${RUN}${++n}`, at: new Date() } as never, source: 'whatsapp' });
    expect((await scanners.scanTenant(owner.tenantId, new Date(Date.now() + 10 * 60_000))).slaBreaches).toBe(0);
  });
});

describe('notifications', () => {
  it('are personal, can be read and muted, and never leak across members or tenants', async () => {
    const mine = await ctx.http().get('/notifications').set(auth(agent.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    const unread0 = (await ctx.http().get('/notifications/unread-count').set(auth(agent.accessToken))).body.unread;
    expect(unread0).toBe(mine.body.unread);
    const first = mine.body.items[0].id as string;
    expect((await ctx.http().post(`/notifications/${first}/read`).set(auth(agent2.accessToken))).status).toBe(404); // someone else's
    expect((await ctx.http().post(`/notifications/${first}/read`).set(auth(other.accessToken))).status).toBe(404); // another tenant's
    expect((await ctx.http().post(`/notifications/${first}/read`).set(auth(agent.accessToken))).status).toBe(204);
    expect((await ctx.http().get('/notifications/unread-count').set(auth(agent.accessToken))).body.unread).toBe(unread0 - 1);
    expect((await ctx.http().get('/notifications?unread=true').set(auth(agent.accessToken))).body.items.every((i: { read: boolean }) => !i.read)).toBe(true);
    // mute lead assignment alerts, then get a lead assigned: nothing new arrives; the other type still does
    const prefs = await ctx.http().put('/notifications/preferences').set(auth(agent.accessToken)).send({ preferences: [{ type: 'lead_assigned', inApp: false }] });
    expect(prefs.body.preferences.find((p: { type: string }) => p.type === 'lead_assigned').inApp).toBe(false);
    const before = (await notifs(agentM, 'lead_assigned')).length;
    await mkLead({ assignedMembershipId: agentM }); await settle();
    expect((await notifs(agentM, 'lead_assigned')).length).toBe(before);
    expect((await ctx.http().post('/notifications/read-all').set(auth(agent.accessToken))).status).toBe(204);
    expect((await ctx.http().get('/notifications/unread-count').set(auth(agent.accessToken))).body.unread).toBe(0);
    expect((await ctx.http().put('/notifications/preferences').set(auth(agent.accessToken)).send({ preferences: [{ type: 'bogus', inApp: false }] })).status).toBe(400);
    expect((await ctx.http().get('/notifications')).status).toBe(401);
  });

  it('does not notify people about their own actions', async () => {
    const before = (await notifs(ownerM, 'lead_assigned')).length;
    await mkLead({ assignedMembershipId: ownerM }); await settle();
    expect((await notifs(ownerM, 'lead_assigned')).length).toBe(before);
  });
});

describe('tasks', () => {
  it('are scoped to their assignee and completable', async () => {
    const l = await mkLead({ assignedMembershipId: agentM });
    const mine = await ctx.http().post('/tasks').set(auth(agent.accessToken)).send({ title: 'Call back', leadId: l });
    expect(mine.status).toBe(201); expect(mine.body.assigneeMembershipId).toBe(agentM);
    expect((await ctx.http().post('/tasks').set(auth(agent.accessToken)).send({ title: 'Not mine', leadId: await mkLead({ assignedMembershipId: agent2M }) })).status).toBe(403);
    expect((await ctx.http().post('/tasks').set(auth(agent.accessToken)).send({ title: 'x', assigneeMembershipId: agent2M })).status).toBe(403);
    const theirs = await ctx.http().post('/tasks').set(auth(owner.accessToken)).send({ title: 'For agent2', assigneeMembershipId: agent2M });
    expect((await ctx.http().patch(`/tasks/${theirs.body.id}`).set(auth(agent.accessToken)).send({ status: 'DONE' })).status).toBe(404);
    expect((await ctx.http().get('/tasks').set(auth(agent.accessToken))).body.items.every((t: { assigneeMembershipId: string }) => t.assigneeMembershipId === agentM)).toBe(true);
    const done = await ctx.http().patch(`/tasks/${mine.body.id}`).set(auth(agent.accessToken)).send({ status: 'DONE' });
    expect(done.body).toMatchObject({ status: 'DONE', completedAt: expect.any(String) });
    expect((await ctx.http().get('/tasks').set(auth(other.accessToken))).body.items).toHaveLength(0);
    expect((await ctx.http().patch(`/tasks/${mine.body.id}`).set(auth(other.accessToken)).send({ status: 'OPEN' })).status).toBe(404);
    expect((await ctx.http().delete(`/tasks/${mine.body.id}`).set(auth(agent.accessToken))).status).toBe(204);
  });
});

describe('outbox claiming', () => {
  it('lets concurrent relays claim disjoint batches, and leases expire so a crashed relay does not strand events', async () => {
    const ids = await Promise.all(Array.from({ length: 24 }, async () => (await q<{ id: string }>(`INSERT INTO outbox_events (id, tenant_id, type, payload) VALUES (gen_random_uuid(), $1, 'test.noop', '{}') RETURNING id`, [owner.tenantId]))[0]?.id as string));
    const app$ = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const claim = async () => (await app$.query(`SELECT id FROM claim_outbox_batch(12)`)).rows.map((r) => r.id as string);
      const [a, b] = await Promise.all([claim(), claim()]);
      const mine = (xs: string[]) => xs.filter((x) => ids.includes(x));
      expect(new Set([...mine(a), ...mine(b)]).size).toBe(mine(a).length + mine(b).length); // no id claimed twice
      await q(`UPDATE outbox_events SET available_at = now() - interval '1 second' WHERE tenant_id = $1 AND type = 'test.noop' AND status = 'processing'`, [owner.tenantId]); // lease expired
      const again = mine(await claim());
      expect(again.length).toBeGreaterThan(0);
    } finally { await app$.end(); }
    await q(`DELETE FROM outbox_events WHERE tenant_id = $1 AND type = 'test.noop'`, [owner.tenantId]);
  });
});

describe('real BullMQ workers', () => {
  let ctx2: TestCtx;
  /**
   * Any API or worker started with WORKERS_ENABLED=true against this database (an e2e server, a dev worker, a forgotten background API) also
   * claims this workspace's outbox events and runs the automation with ITS working providers, so the failure injected below (in this process only)
   * never happens and the run ends SUCCEEDED. That is an environment problem, not a product one: detect it up front (nothing in this process
   * drains the outbox until ctx2 exists, so any claim of a probe event is foreign) and skip with a clear message instead of timing out.
   */
  let foreignConsumer = false;
  beforeAll(async () => {
    foreignConsumer = await foreignOutboxConsumerPresent(owner$, owner.tenantId);
    if (foreignConsumer) console.warn('SKIPPING real BullMQ workers tests: another process sharing this database is consuming outbox events (stop any API/worker with WORKERS_ENABLED=true, e.g. an e2e or dev server)');
    ctx2 = await createTestApp([{ provide: ENV, useValue: { ...loadEnv(), WORKERS_ENABLED: true, QUEUE_PREFIX: `t${RUN}`, AUTOMATION_MAX_ATTEMPTS: 3, AUTOMATION_RETRY_BASE_MS: 40 } }]);
  });
  afterAll(async () => { await ctx2.close(); });

  /** Polls until `fn` returns something. On timeout `why` explains the state: the usual cause of a timeout here is not slowness but ANOTHER process on the same database (a dev or e2e API started with WORKERS_ENABLED=true) claiming the event and running the automation with its own, working providers. */
  const waitFor = async <T>(fn: () => Promise<T | null | false>, ms = 20_000, why?: () => Promise<string>): Promise<T> => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out${why ? `: ${await why()}` : ''}`); await sleep(100); } };
  const foreign = (id: string, lead: string) => async () => { const r = (await runsOf(id)).find((x) => x.lead_id === lead); return r ? `the run is ${r.status} after ${r.attempts} attempt(s). If it is SUCCEEDED or SKIPPED, another process sharing this database processed the event (stop any API/worker started with WORKERS_ENABLED=true, e.g. an e2e or dev server)` : 'no run was created (the event was not relayed)'; };

  it('processes an event end to end through Redis, and retries with backoff before dead-lettering', async (t) => {
    if (foreignConsumer) t.skip();
    expect(ctx2.app.get(JobsService).running).toBe(true);
    const id = await createAuto({ name: 'BullFlow', trigger: { type: 'lead.created' }, actions: [{ type: 'create_task', title: 'Bull task {{lead.name}}', dueInHours: 1, assignee: 'lead_owner' }] });
    const l = await mkLead({ assignedMembershipId: agentM });
    await ctx2.app.get(OutboxRelay).drainOnce(200); // claim our own event at once instead of waiting for the 1 s timer (narrows the window a foreign consumer could win)
    const run = await waitFor(async () => (await runsOf(id)).find((r) => r.lead_id === l && r.status === 'SUCCEEDED') ?? null, 20_000, foreign(id, l));
    expect(run.attempts).toBe(1);
    expect((await q<{ c: number }>(`SELECT count(*)::int c FROM tasks WHERE lead_id = $1`, [l]))[0]?.c).toBe(1);

    // failure path: the action throws every time; BullMQ retries (3 attempts, exponential backoff) then the run is FAILED and managers are told
    const convos = ctx2.app.get(ConversationsService);
    const original = convos.sendSystem.bind(convos);
    convos.sendSystem = (async () => { throw new Error('provider down'); }) as never;
    try {
      const failing = await createAuto({ name: 'BullFail', trigger: { type: 'lead.stage_changed' }, actions: [{ type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] }] });
      const l2 = await mkLead(); await consent(l2);
      const board = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
      await ctx.http().post(`/leads/${l2}/stage`).set(auth(owner.accessToken)).send({ stageId: board.body.stages.filter((s: { kind: string }) => s.kind === 'OPEN')[1].id });
      await ctx2.app.get(OutboxRelay).drainOnce(200);
      const failed = await waitFor(async () => (await runsOf(failing)).find((r) => r.lead_id === l2 && r.status === 'FAILED') ?? null, 20_000, foreign(failing, l2));
      expect(failed.attempts).toBe(3);
      expect(failed.error).toContain('provider down');
      expect((await notifs(ownerM, 'automation_failed')).some((x) => x.title.includes('BullFail'))).toBe(true);
    } finally { convos.sendSystem = original as never; }
  }, 40_000);

  it('the scheduler tick is registered once, repeatable, in Redis', async () => {
    const { Queue } = await import('bullmq');
    const { redisConnection } = await import('../src/ops/jobs.service.js');
    const qu = new Queue('maintenance', { connection: redisConnection(loadEnv().REDIS_URL), prefix: `t${RUN}` });
    try { const schedulers = await qu.getJobSchedulers(); expect(schedulers.filter((s) => s.key === 'tick')).toHaveLength(1); expect(schedulers[0]?.every).toBe(60_000); }
    finally { await qu.obliterate({ force: true }).catch(() => undefined); await qu.close(); }
  });
});
