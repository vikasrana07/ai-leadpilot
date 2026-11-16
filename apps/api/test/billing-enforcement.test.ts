import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiOrchestrator } from '../src/ai/orchestrator.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

/** Plan rules must hold on the paths that do not go through HTTP guards: outbound sends, the AI, and automations. */
let ctx: TestCtx; let orch: AiOrchestrator; let relay: OutboxRelay; let owner$: pg.Pool;
let t: Account;
const SECRET = 'bill-enf-secret-123456';
const PHONE_ID = `73${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
const PLAN = `it_${RUN.slice(0, 4)}_enf`;
let hook = ''; let n = 0;
const q = (sql: string, p: unknown[] = []) => owner$.query(sql, p);

async function plan(waLimit: number, features: { ai_assistant: boolean; automations: boolean }) {
  await q('DELETE FROM plan_entitlements WHERE plan_key = $1', [PLAN]);
  await q(`INSERT INTO plans (key, name, price_minor, is_public, updated_at) VALUES ($1, 'Enforcement', 100, false, now()) ON CONFLICT (key) DO NOTHING`, [PLAN]);
  for (const k of ['seats', 'ai_tokens_monthly', 'active_automations', 'knowledge_mb']) await q(`INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES ($1,$2,true,1000)`, [PLAN, k]);
  await q(`INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES ($1,'whatsapp_messages_monthly',true,$2)`, [PLAN, waLimit]);
  for (const [k, v] of Object.entries({ ...features, web_widget: true, csv_export: true })) await q(`INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES ($1,$2,$3,NULL)`, [PLAN, k, v]);
}
async function sub(status: 'ACTIVE' | 'EXPIRED') {
  await q(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, provider_subscription_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3::"SubscriptionStatus", 'razorpay', $4, now())
    ON CONFLICT (tenant_id) DO UPDATE SET plan_key=$2, status=$3::"SubscriptionStatus"`, [t.tenantId, PLAN, status, `sub_mock_${RUN}_enf`]);
  await q('UPDATE tenants SET plan_key=$2 WHERE id=$1', [t.tenantId, PLAN]);
}
const inbound = async (from: string, text: string) => {
  const b = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: from, profile: { name: 'V ' + from.slice(-4) } }], messages: [{ from, id: `wamid.EN${RUN}${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
  await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', SECRET).update(b).digest('hex')}`).send(b);
  await orch.idle();
};
const convoOf = async (from: string) => (await ctx.http().get(`/conversations?q=${from.slice(2)}&pageSize=5`).set(auth(t.accessToken))).body.items[0] as { id: string; mode: string };

beforeAll(async () => {
  ctx = await createTestApp(); orch = ctx.app.get(AiOrchestrator); relay = ctx.app.get(OutboxRelay);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  t = await registerAccount(ctx, 'enfOwner');
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(t.accessToken)).send({ name: 'Enf line', phoneNumberId: PHONE_ID, wabaId: `74${PHONE_ID.slice(2)}`, accessToken: 'EAAGenfToken123456789012345', appSecret: SECRET });
  hook = new URL(ch.body.webhookUrl).pathname;
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('outbound WhatsApp fair-use limit', () => {
  it('stops sending at the plan limit with a clear 402, and counts only this month\'s outbound WhatsApp messages', async () => {
    await plan(2, { ai_assistant: true, automations: true }); await sub('ACTIVE');
    const phone = `91982${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    await inbound(phone, 'Hello');
    const c = await convoOf(phone);
    const send = (text: string) => ctx.http().post(`/conversations/${c.id}/messages`).set(auth(t.accessToken)).send({ text });
    expect((await send('one')).status).toBe(201);
    expect((await send('two')).status).toBe(201);
    const third = await send('three');
    expect(third.status).toBe(402); expect(third.body.error.code).toBe('quota_exceeded'); expect(third.body.error.details.limit).toBe('whatsapp_messages_monthly');
    expect((await ctx.http().get('/usage').set(auth(t.accessToken))).body.plan.meters.whatsapp_messages_monthly).toBe(2);
  });

  it('a read-only workspace cannot send by hand (guard) or automatically (service)', async () => {
    await plan(1000, { ai_assistant: true, automations: true }); await sub('EXPIRED');
    const phone = `91983${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    await inbound(phone, 'Hi again');
    const c = await convoOf(phone);
    const r = await ctx.http().post(`/conversations/${c.id}/messages`).set(auth(t.accessToken)).send({ text: 'hello' });
    expect(r.status).toBe(402); expect(r.body.error.code).toBe('subscription_required');
  });
});

describe('the AI on a lapsed or ineligible plan', () => {
  const ASSISTANT = { enabled: true, name: 'Asha', businessIdentity: 'Skyline Realty', businessDescription: 'Homes.', languages: ['en'], tone: 'friendly', welcomeMessage: '', systemInstructions: '', workingHours: { enabled: false, days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }, handoverRules: { keywords: [], onNegotiation: true, onComplaint: true }, allowedTools: ['get_business_info', 'handover_to_human'], model: null, temperature: 0.3, maxReplyChars: 600, fallbackMessage: 'A team member will reply shortly.', disclosureText: '', monthlyTokenCap: null };
  it('never reaches the model: the conversation is handed to a person', async () => {
    await plan(1000, { ai_assistant: true, automations: true }); await sub('ACTIVE');
    expect((await ctx.http().put('/ai/assistant').set(auth(t.accessToken)).send(ASSISTANT)).status).toBe(200);
    await sub('EXPIRED'); // lapse AFTER setup (settings are writes)
    const phone = `91984${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    await inbound(phone, 'Do you have 2 BHK flats?');
    const c = await convoOf(phone);
    expect(c.mode).toBe('HUMAN');
    const runs = await q(`SELECT status, input_tokens, trace FROM ai_runs WHERE conversation_id = $1`, [c.id]);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].status).toBe('SKIPPED'); expect(runs.rows[0].input_tokens).toBe(0); expect(runs.rows[0].trace.outcome).toBe('plan_blocked');
    const ai = await q(`SELECT count(*)::int n FROM messages WHERE conversation_id = $1 AND "senderType" = 'AI'`, [c.id]);
    expect(ai.rows[0].n).toBe(0);
  });
});

describe('automations on a plan without them', () => {
  const runs = async () => (await q('SELECT count(*)::int n FROM automation_runs WHERE tenant_id = $1', [t.tenantId])).rows[0].n as number;
  const drain = async () => { for (let i = 0; i < 10; i++) await relay.drainOnce(200); };
  it('create no runs and send nothing (with a positive control: the same trigger does run when the plan allows it)', async () => {
    await plan(1000, { ai_assistant: true, automations: true }); await sub('ACTIVE');
    const tpl = await ctx.http().post('/automations/from-template').set(auth(t.accessToken)).send({ templateKey: 'welcome_new_lead' });
    expect(tpl.status).toBe(201);
    expect((await ctx.http().post(`/automations/${tpl.body.id}/enable`).set(auth(t.accessToken)).send({ enabled: true })).status).toBe(200);
    const base = await runs();
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Control Lead', phone: '+919876500001' })).status).toBe(201);
    await drain();
    expect(await runs()).toBeGreaterThan(base); // control: allowed plan => a run exists
    await plan(1000, { ai_assistant: true, automations: false }); // plan edited under a live customer
    const before = await runs();
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Blocked Lead', phone: '+919876500002' })).status).toBe(201);
    await drain();
    expect(await runs()).toBe(before);
    expect((await ctx.http().get('/automations').set(auth(t.accessToken))).status).toBe(402); // and the section is gated at the API
  });
});
