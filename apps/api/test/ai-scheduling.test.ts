import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkReply, timesIn } from '../src/ai/guards.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';
import { AiOrchestrator } from '../src/ai/orchestrator.js';
import { ToolRunner, modelTools, type ToolContext } from '../src/ai/tools.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let orch: AiOrchestrator; let tools: ToolRunner; let owner$: pg.Pool;
let owner: Account; let other: Account;
const APP_SECRET = 'sched-test-secret-123456'; const PHONE_ID = `71${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
let hook = ''; let n = 0;
const ASSISTANT = { enabled: true, name: 'Asha', businessIdentity: 'Skyline Realty', businessDescription: 'Homes in Pune.', languages: ['en'], tone: 'friendly', welcomeMessage: '', systemInstructions: '', workingHours: { enabled: false, days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }, handoverRules: { keywords: [], onNegotiation: true, onComplaint: true }, allowedTools: ['get_business_info', 'update_lead', 'check_availability', 'create_appointment', 'handover_to_human'], model: null, temperature: 0.3, maxReplyChars: 600, fallbackMessage: 'A team member will reply shortly.', disclosureText: '', monthlyTokenCap: null };

const inbound = async (from: string, text: string) => {
  const b = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: from, profile: { name: 'Visitor ' + from.slice(-4) } }], messages: [{ from, id: `wamid.SC${RUN}${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
  await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(b).digest('hex')}`).send(b);
  await orch.idle();
};
const convoOf = async (from: string) => (await ctx.http().get(`/conversations?q=${from.slice(2)}&pageSize=5`).set(auth(owner.accessToken))).body.items[0];
const aiReplies = async (id: string) => ((await ctx.http().get(`/conversations/${id}/messages`).set(auth(owner.accessToken))).body.items as { senderType: string; body: string }[]).filter((m) => m.senderType === 'AI').map((m) => m.body);
const appts = async (t = owner) => (await ctx.http().get('/appointments').set(auth(t.accessToken))).body.items as { id: string; source: string; status: string; startsAt: string; leadId: string; membershipId: string }[];

beforeAll(async () => {
  ctx = await createTestApp();
  orch = ctx.app.get(AiOrchestrator); tools = ctx.app.get(ToolRunner);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'scOwner'); other = await registerAccount(ctx, 'scOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  await addMember(ctx, owner, 'scAgent', 'agent');
  await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: null, rules: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 600, endMinute: 780 })) });
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ name: 'Sched line', phoneNumberId: PHONE_ID, wabaId: `72${PHONE_ID.slice(2)}`, accessToken: 'EAAGschedToken12345678901234', appSecret: APP_SECRET });
  hook = new URL(ch.body.webhookUrl).pathname;
  expect((await ctx.http().put('/ai/assistant').set(auth(owner.accessToken)).send(ASSISTANT)).status).toBe(200);
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('time guard and prompt (pure)', () => {
  it('normalises clock times', () => {
    expect([...timesIn('see you at 4 pm, or 10:30 AM, 12 am or 14:00')].sort()).toEqual(['00:00', '10:30', '14:00', '16:00']);
    expect(timesIn('price 1.2 Cr, 2027 units').size).toBe(0);
  });
  it('blocks a reply that offers a time no tool returned, allows one that did', () => {
    const facts = '{"slots":[{"time":"11:00","label":"Sat, 21 Nov, 11:00 AM"}]}';
    expect(checkReply({ reply: 'How about 11 AM?', facts, canary: 'CANARY', maxChars: 500 }).ok).toBe(true);
    const bad = checkReply({ reply: 'I can do 3 pm tomorrow.', facts, canary: 'CANARY', maxChars: 500 });
    expect(bad.ok).toBe(false); expect(bad.violations).toContain('unsupported_time:15:00');
  });
  it('only mentions scheduling when both tools are on', () => {
    const base = { assistant: { name: 'A', businessIdentity: 'B', businessDescription: '', languages: ['en'], tone: 'friendly', welcomeMessage: '', systemInstructions: '', maxReplyChars: 500, workingHours: null }, tenant: { name: 'T', industry: 'real_estate', timezone: 'Asia/Kolkata' }, lead: { name: 'L', known: [], missing: [] }, nowIso: '2027-01-01T00:00:00Z', firstReply: false } as never;
    expect(buildSystemPrompt({ ...(base as object), toolNames: ['check_availability', 'create_appointment'] } as never)).toContain('SCHEDULING');
    expect(buildSystemPrompt({ ...(base as object), toolNames: [] } as never)).toContain('scheduling is not available');
    expect(modelTools(new Set(['check_availability', 'create_appointment', 'search_properties'])).map((t) => t.name).sort()).toEqual(['check_availability', 'create_appointment', 'search_properties']);
  });
});

describe('AI books site visits through real availability', () => {
  it('offers only real free times, books the one the customer picks as a PENDING appointment, and tells the team', async () => {
    const phone = `91981${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    await inbound(phone, 'Hi, I want to book a site visit tomorrow');
    const c = await convoOf(phone);
    const first = (await aiReplies(c.id)).at(-1) as string;
    expect(first).toMatch(/free for a site visit/);
    const offered = [...first.matchAll(/(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}) (AM|PM)/g)];
    expect(offered.length).toBeGreaterThanOrEqual(2);
    for (const o of offered) { const h = Number((o[2] as string).split(':')[0]) % 12 + ((o[3] as string) === 'PM' ? 12 : 0); expect(h).toBeGreaterThanOrEqual(10); expect(h).toBeLessThan(13); } // inside the 10:00-13:00 availability window
    const pickTime = `${(offered[1] as RegExpMatchArray)[2]} ${(offered[1] as RegExpMatchArray)[3]}`.replace(/^(\d{1,2}):00/, '$1');
    await inbound(phone, `${pickTime} works for me`);
    const reply = (await aiReplies(c.id)).at(-1) as string;
    expect(reply).toMatch(/requested your site visit/);
    const list = (await appts()).filter((a) => a.source === 'ai');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'PENDING' });
    expect((await ctx.http().get(`/leads/${list[0]?.leadId}`).set(auth(owner.accessToken))).body.siteVisitRequested).toBe(true);
    const ev = await owner$.query(`SELECT count(*)::int c FROM outbox_events WHERE tenant_id = $1 AND type = 'appointment.booked' AND payload->>'appointmentId' = $2`, [owner.tenantId, list[0]?.id]);
    expect(ev.rows[0].c).toBe(1);
    // the evidence trail exists
    const runs = await owner$.query(`SELECT trace FROM ai_runs WHERE conversation_id = $1 ORDER BY created_at`, [c.id]);
    expect(JSON.stringify(runs.rows.map((r) => r.trace))).toContain('create_appointment');
    // asking again does not create a second visit
    await inbound(phone, 'Can I book a visit tomorrow again?');
    await inbound(phone, `${pickTime} works for me`);
    expect((await appts()).filter((a) => a.source === 'ai')).toHaveLength(1);
  });

  it('refuses a time that is not actually free and never double books', async () => {
    let conversationId = '';
    // The audit tables now have real foreign keys (S-09): a tool call needs a real conversation and AI run to be recorded against.
    const channelId = randomUUID();
    await owner$.query(`INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at) VALUES ($1, $2, 'WHATSAPP', 'Tools', 'ACTIVE', $3, '{}'::jsonb, now())`, [channelId, owner.tenantId, `tools-${channelId}`]);
    const realConversation = async (leadId: string) => { const id = randomUUID(); await owner$.query(`INSERT INTO conversations (id, tenant_id, channel_id, lead_id, external_thread_id) VALUES ($1, $2, $3, $4, $5)`, [id, owner.tenantId, channelId, leadId, `t-${id}`]); return id; };
    const realRun = async (convId: string) => { const id = randomUUID(); await owner$.query(`INSERT INTO ai_runs (id, tenant_id, conversation_id, prompt_version, status) VALUES ($1, $2, $3, 'test', 'COMPLETED')`, [id, owner.tenantId, convId]); return id; };
    const ctxTool = async (): Promise<ToolContext> => {
      const t = await owner$.query(`SELECT id, name, email, phone, website, address, timezone, currency FROM tenants WHERE id = $1`, [owner.tenantId]);
      const l = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Tool Lead ${++n}`, phone: `98${String(40_000_000 + n * 7919).slice(0, 8)}` });
      conversationId = await realConversation(l.body.id);
      return { tenantId: owner.tenantId, conversationId, leadId: l.body.id, runId: await realRun(conversationId), allowed: new Set(['check_availability', 'create_appointment']), assistant: { workingHours: null, name: 'A', businessIdentity: 'B', businessDescription: '', languages: ['en'] }, tenant: { name: t.rows[0].name, email: t.rows[0].email, phone: null, website: null, address: null, timezone: t.rows[0].timezone, currency: 'INR' } };
    };
    const tc = await ctxTool();
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const outside = await tools.execute({ ...tc, runId: await realRun(tc.conversationId) }, 'create_appointment', JSON.stringify({ date: day, time: '15:00', notes: null }));
    expect(outside.ok).toBe(false); expect(outside.result).toMatchObject({ error: 'slot_unavailable' });
    const past = await tools.execute({ ...tc, runId: await realRun(tc.conversationId) }, 'create_appointment', JSON.stringify({ date: '2020-01-01', time: '10:00', notes: null }));
    expect(past.ok).toBe(false);
    const avail = await tools.execute({ ...tc, runId: await realRun(tc.conversationId) }, 'check_availability', JSON.stringify({ date: day, durationMinutes: null }));
    expect(avail.ok).toBe(true);
    const slots = (avail.result as { slots: { date: string; time: string }[] }).slots;
    expect(slots.length).toBeGreaterThan(0);
    const s = slots[0] as { date: string; time: string };
    const book = async (leadId: string) => { const conversationId = await realConversation(leadId); return tools.execute({ ...tc, leadId, conversationId, runId: await realRun(conversationId) }, 'create_appointment', JSON.stringify({ date: s.date, time: s.time, notes: null })); };
    const l2 = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Tool Lead ${++n}`, phone: `98${String(50_000_000 + n * 7919).slice(0, 8)}` })).body.id as string;
    const l3 = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Tool Lead ${++n}`, phone: `98${String(60_000_000 + n * 7919).slice(0, 8)}` })).body.id as string;
    const results = await Promise.all([book(tc.leadId), book(l2), book(l3)]);
    // two people can take visits (owner + agent): at most two of three simultaneous bookings for the same slot succeed
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    const again = await book(tc.leadId);
    expect(again.ok).toBe(false);
  });

  it('is isolated per tenant: another workspace sees none of it', async () => {
    expect((await appts(other)).length).toBe(0);
  });
});
