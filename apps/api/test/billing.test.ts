import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withGst } from '@leadpilot/validation';
import { BillingLifecycle } from '../src/ops/billing-lifecycle.js';
import { buildMockEvent, type MockEventKind } from '../src/billing/mock-events.js';
import { hmacHex, MOCK_WEBHOOK_SECRET } from '../src/billing/provider.js';
import { addMember, auth, cleanup, createTestApp, RUN, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const owner = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let a: Account; let b: Account;
let evt = 0;
const eid = () => `it-${RUN}-evt-${++evt}`;

beforeAll(async () => {
  ctx = await createTestApp();
  a = await registerAccount(ctx, 'billA');
  b = await registerAccount(ctx, 'billB');
  for (const x of [a, b]) await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', x.email)?.token });
});
afterAll(async () => { await ctx.close(); await cleanup(); await owner.end(); await app.end(); });

/** Puts a workspace on a plan/state directly (the platform console and webhooks are tested separately). */
async function setSub(tenantId: string, s: { plan: string; status: string; providerSub?: string | null; trialEndsAt?: Date | null; periodEnd?: Date | null; graceEndsAt?: Date | null; pending?: string | null; cancelAtEnd?: boolean }) {
  await owner.query(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, provider_subscription_id, trial_ends_at, current_period_end, grace_ends_at, pending_plan_key, cancel_at_period_end, updated_at)
    VALUES (gen_random_uuid(), $1, $2, $3::"SubscriptionStatus", $4, $5, $6, $7, $8, $9, $10, now())
    ON CONFLICT (tenant_id) DO UPDATE SET plan_key=$2, status=$3::"SubscriptionStatus", provider=$4, provider_subscription_id=$5, trial_ends_at=$6, current_period_end=$7, grace_ends_at=$8, pending_plan_key=$9, cancel_at_period_end=$10`,
    [tenantId, s.plan, s.status, s.providerSub ? 'razorpay' : 'none', s.providerSub ?? null, s.trialEndsAt ?? null, s.periodEnd ?? null, s.graceEndsAt ?? null, s.pending ?? null, s.cancelAtEnd ?? false]);
  await owner.query('UPDATE tenants SET plan_key = $2 WHERE id = $1', [tenantId, s.plan]);
}
const day = 86_400_000;

async function hook(kind: MockEventKind, subscriptionId: string, o: { eventId?: string; paymentId?: string; amountMinor?: number; sign?: boolean; periodEnd?: Date } = {}) {
  const { body, eventId } = buildMockEvent({ kind, subscriptionId, eventId: o.eventId ?? eid(), ...(o.paymentId ? { paymentId: o.paymentId } : {}), ...(o.amountMinor ? { amountMinor: o.amountMinor } : {}), ...(o.periodEnd ? { periodEnd: o.periodEnd } : {}) });
  const sig = o.sign === false ? 'deadbeef' : hmacHex(MOCK_WEBHOOK_SECRET, body);
  return ctx.http().post('/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', eventId).send(body.toString());
}
const profile = (stateCode: string, gstin: string | null = null) => ({ legalName: 'Skyline Realty Pvt Ltd', gstin, stateCode, addressLine: '12 MG Road', city: 'Bengaluru', pincode: '560001' });
const subRow = async (t: string) => (await owner.query('SELECT * FROM subscriptions WHERE tenant_id = $1', [t])).rows[0];
const owned = (t: string, k: string) => owner.query('SELECT count(*)::int n FROM notifications WHERE tenant_id=$1 AND type=$2', [t, k]).then((r) => r.rows[0].n as number);

describe('plans & billing profile', () => {
  it('lists public plans from the database with GST-inclusive prices, never the internal plan', async () => {
    const r = await ctx.http().get('/billing/plans').set(auth(a.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.map((p: { key: string }) => p.key)).toEqual(expect.arrayContaining(['starter', 'growth', 'premium']));
    expect(r.body.find((p: { key: string }) => p.key === 'internal')).toBeUndefined();
    const g = r.body.find((p: { key: string }) => p.key === 'growth');
    expect(g.priceMinor).toBe(999900); expect(g.priceWithGstMinor).toBe(withGst(999900)); expect(g.priceWithGstMinor).toBe(1179882);
  });

  it('a default workspace is on the unmetered internal plan', async () => {
    const r = await ctx.http().get('/billing/summary').set(auth(a.accessToken));
    expect(r.body.status).toBe('INTERNAL'); expect(r.body.restricted).toBe(false); expect(r.body.limits.seats).toBeNull();
  });

  it('validates GSTIN format and state agreement; only billing managers can edit', async () => {
    const bad = await ctx.http().put('/billing/profile').set(auth(a.accessToken)).send(profile('29', 'NOTAGSTIN'));
    expect(bad.status).toBe(400);
    const mismatch = await ctx.http().put('/billing/profile').set(auth(a.accessToken)).send(profile('27', '29ABCDE1234F1Z5'));
    expect(mismatch.status).toBe(400);
    const ok = await ctx.http().put('/billing/profile').set(auth(a.accessToken)).send(profile('29', '29ABCDE1234F1Z5'));
    expect(ok.status).toBe(200);
    const agent = await addMember(ctx, a, 'billAgent', 'agent');
    expect((await ctx.http().put('/billing/profile').set(auth(agent.accessToken)).send(profile('29'))).status).toBe(403);
    expect((await ctx.http().get('/billing/summary').set(auth(agent.accessToken))).status).toBe(200); // banners need it
    await owner.query("UPDATE memberships SET status='DEACTIVATED' WHERE user_id=$1", [agent.userId]);
  });
});

describe('subscribe & webhooks', () => {
  let subId: string;
  it('needs a billing profile first, then returns a checkout whose amount includes GST', async () => {
    const fresh = b;
    const no = await ctx.http().post('/billing/subscribe').set(auth(fresh.accessToken)).send({ planKey: 'growth' });
    expect(no.status).toBe(409); expect(no.body.error.code).toBe('billing_profile_required');
    const r = await ctx.http().post('/billing/subscribe').set(auth(a.accessToken)).send({ planKey: 'growth' });
    expect(r.status).toBe(200); expect(r.body.mode).toBe('mock'); expect(r.body.amountMinor).toBe(1179882);
    subId = r.body.subscriptionId as string;
    expect(subId).toMatch(/^sub_mock_/);
    expect((await ctx.http().post('/billing/subscribe').set(auth(a.accessToken)).send({ planKey: 'internal' })).status).toBe(404);
  });

  it('rejects missing, forged and tampered signatures without touching state', async () => {
    const bad = await hook('activated', subId, { sign: false });
    expect(bad.status).toBe(401);
    const { body } = buildMockEvent({ kind: 'activated', subscriptionId: subId, eventId: eid() });
    const tampered = await ctx.http().post('/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', hmacHex(MOCK_WEBHOOK_SECRET, body)).send(body.toString().replace('active', 'activf'));
    expect(tampered.status).toBe(401);
    expect((await ctx.http().post('/webhooks/razorpay').set('content-type', 'application/json').send(body.toString())).status).toBe(401);
    expect((await subRow(a.tenantId)).status).not.toBe('PAST_DUE');
  });

  it('activation switches the plan and issues nothing until a payment is captured', async () => {
    const r = await hook('activated', subId);
    expect(r.status).toBe(200); expect(r.body.status).toBe('processed');
    const s = await subRow(a.tenantId);
    expect(s.status).toBe('ACTIVE'); expect(s.plan_key).toBe('growth'); expect(s.pending_plan_key).toBeNull();
    expect((await owner.query('SELECT plan_key FROM tenants WHERE id=$1', [a.tenantId])).rows[0].plan_key).toBe('growth');
  });

  it('a captured payment creates exactly one GST invoice (CGST+SGST for same-state buyers), even when delivered twice', async () => {
    const ev = eid();
    const first = await hook('charged', subId, { eventId: ev, paymentId: `pay_${RUN}_1`, amountMinor: 1179882 });
    expect(first.body.status).toBe('processed');
    expect((await hook('charged', subId, { eventId: ev, paymentId: `pay_${RUN}_1`, amountMinor: 1179882 })).body.status).toBe('duplicate');
    // same payment redelivered under a NEW event id (provider retries sometimes do this): still one invoice
    expect((await hook('charged', subId, { paymentId: `pay_${RUN}_1`, amountMinor: 1179882 })).status).toBe(200);
    const list = await ctx.http().get('/billing/invoices').set(auth(a.accessToken));
    expect(list.body).toHaveLength(1);
    const inv = (await ctx.http().get(`/billing/invoices/${list.body[0].id}`).set(auth(a.accessToken))).body;
    expect(inv.number).toMatch(/^LP\/\d{4}-\d{2}\/\d{6}$/);
    expect(inv.taxableMinor).toBe(999900); expect(inv.cgstMinor).toBe(89991); expect(inv.sgstMinor).toBe(89991); expect(inv.igstMinor).toBe(0); expect(inv.totalMinor).toBe(1179882);
    expect(inv.buyer.gstin).toBe('29ABCDE1234F1Z5'); expect(inv.gstRatePercent).toBe(18); expect(inv.sac).toMatch(/^\d{4,8}$/);
    expect((await owner.query('SELECT count(*)::int n FROM payments WHERE tenant_id=$1', [a.tenantId])).rows[0].n).toBe(1);
    expect(await owned(a.tenantId, 'billing')).toBeGreaterThan(0);
  });

  it('charges IGST when the buyer is in another state', async () => {
    await ctx.http().put('/billing/profile').set(auth(a.accessToken)).send(profile('27', '27ABCDE1234F1Z5'));
    await hook('charged', subId, { paymentId: `pay_${RUN}_2`, amountMinor: 1179882 });
    const inv = (await ctx.http().get('/billing/invoices').set(auth(a.accessToken))).body[0];
    const full = (await ctx.http().get(`/billing/invoices/${inv.id}`).set(auth(a.accessToken))).body;
    expect(full.igstMinor).toBe(179982); expect(full.cgstMinor).toBe(0); expect(full.sgstMinor).toBe(0); expect(full.placeOfSupply).toBe('Maharashtra');
  });

  it('invoice numbers are unique and gap-free under concurrent payments from different workspaces', async () => {
    const accts: Account[] = [];
    for (let i = 0; i < 5; i++) { const t = await registerAccount(ctx, `billC${i}`); accts.push(t); await setSub(t.tenantId, { plan: 'growth', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_c${i}` }); }
    const res = await Promise.all(accts.map((t, i) => hook('charged', `sub_mock_${RUN}_c${i}`, { paymentId: `pay_${RUN}_c${i}`, amountMinor: 1179882 })));
    expect(res.every((r) => r.status === 200 && r.body.status === 'processed')).toBe(true);
    const rows = (await owner.query('SELECT number FROM invoices WHERE tenant_id = ANY($1)', [accts.map((x) => x.tenantId)])).rows.map((r) => Number((r.number as string).split('/')[2]));
    expect(new Set(rows).size).toBe(5);
    expect(Math.max(...rows) - Math.min(...rows)).toBe(4);
  });

  it('one workspace never sees another workspace\'s invoices', async () => {
    const mine = (await ctx.http().get('/billing/invoices').set(auth(a.accessToken))).body[0];
    expect((await ctx.http().get(`/billing/invoices/${mine.id}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await ctx.http().get('/billing/invoices').set(auth(b.accessToken))).body).toHaveLength(0);
    expect((await ctx.http().get('/billing/invoices').set(auth(a.accessToken))).status).toBe(200);
  });

  it('ignores events for unknown or superseded subscriptions without failing (so the provider stops retrying)', async () => {
    const unknown = await hook('charged', 'sub_does_not_exist', { paymentId: `pay_${RUN}_x`, amountMinor: 100 });
    expect(unknown.status).toBe(200); expect(unknown.body.status).toBe('ignored');
  });

  it('keeps invoices immutable and the platform audit trail append-only at the database level', async () => {
    await expect(app.query("UPDATE invoices SET total_minor = 1")).rejects.toThrow(/permission denied/);
    await expect(app.query("DELETE FROM invoices")).rejects.toThrow(/permission denied/);
    await expect(app.query("UPDATE platform_audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query("DELETE FROM platform_audit_logs")).rejects.toThrow(/permission denied/);
    await expect(app.query("INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), 'x@x.test', 'h', 'x')")).rejects.toThrow(/permission denied/);
  });
});

describe('dunning, grace and read-only mode', () => {
  let t: Account; const sub = () => `sub_mock_${RUN}_dun`;
  beforeAll(async () => {
    t = await registerAccount(ctx, 'billDun');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
    await setSub(t.tenantId, { plan: 'growth', status: 'ACTIVE', providerSub: sub(), periodEnd: new Date(Date.now() + 10 * day) });
  });

  it('a failed renewal starts a grace period: owners are told, nothing stops working', async () => {
    const r = await hook('pending', sub());
    expect(r.body.status).toBe('processed');
    const s = await subRow(t.tenantId);
    expect(s.status).toBe('PAST_DUE');
    expect(new Date(s.grace_ends_at).getTime() - Date.now()).toBeGreaterThan(6 * day);
    expect(await owned(t.tenantId, 'billing')).toBe(1);
    expect(ctx.mail.sent.some((m) => m.kind === 'billing' && m.to === t.email && /payment failed/i.test(m.subject ?? ''))).toBe(true);
    const w = await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Grace Lead', phone: '+919811111111' });
    expect(w.status).toBe(201);
  });

  it('after the grace period the workspace is read-only: writes 402, reads and billing still work', async () => {
    await owner.query("UPDATE subscriptions SET grace_ends_at = now() - interval '1 hour' WHERE tenant_id=$1", [t.tenantId]);
    const w = await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Blocked', phone: '+919822222222' });
    expect(w.status).toBe(402); expect(w.body.error.code).toBe('subscription_required');
    expect((await ctx.http().get('/leads').set(auth(t.accessToken))).status).toBe(200);
    expect((await ctx.http().get('/billing/summary').set(auth(t.accessToken))).body.restricted).toBe(true);
    expect((await ctx.http().put('/billing/profile').set(auth(t.accessToken)).send(profile('29'))).status).toBe(200);
    // the lifecycle job records the lapse once and tells the owner exactly once
    const lc = ctx.app.get(BillingLifecycle);
    await lc.tick(t.tenantId); await lc.tick(t.tenantId);
    expect((await subRow(t.tenantId)).status).toBe('EXPIRED');
    expect(ctx.mail.sent.filter((m) => m.kind === 'billing' && m.to === t.email && /lapsed/i.test(m.subject ?? ''))).toHaveLength(1);
  });

  it('a successful payment restores full access immediately', async () => {
    const r = await hook('charged', sub(), { paymentId: `pay_${RUN}_dun`, amountMinor: 1179882 });
    expect(r.body.status).toBe('processed');
    expect((await subRow(t.tenantId)).status).toBe('ACTIVE');
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Back', phone: '+919833333333' })).status).toBe(201);
  });

  it('cancellation keeps access to the end of the paid period, then locks writes', async () => {
    await hook('cancelled', sub());
    expect((await subRow(t.tenantId)).status).toBe('CANCELED');
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Still ok', phone: '+919844444444' })).status).toBe(201);
    await owner.query("UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE tenant_id=$1", [t.tenantId]);
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Too late', phone: '+919855555555' })).status).toBe(402);
  });

  it('a late renewal event never revives a cancelled subscription', async () => {
    await owner.query("UPDATE subscriptions SET current_period_end = now() + interval '5 days' WHERE tenant_id=$1", [t.tenantId]);
    await hook('activated', sub());
    expect((await subRow(t.tenantId)).status).toBe('CANCELED');
  });
});

describe('trial lifecycle', () => {
  it('an ended trial is read-only at once (derived from dates), and the owner is told exactly once', async () => {
    const t = await registerAccount(ctx, 'billTrial');
    await setSub(t.tenantId, { plan: 'growth', status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000) });
    const w = await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'x', phone: '+919866666666' });
    expect(w.status).toBe(402); expect(w.body.error.message).toMatch(/trial has ended/i);
    const lc = ctx.app.get(BillingLifecycle);
    await lc.tick(t.tenantId); await lc.tick(t.tenantId);
    expect(await owned(t.tenantId, 'billing')).toBe(1);
    expect((await subRow(t.tenantId)).status).toBe('EXPIRED');
  });

  it('warns once when the trial is about to end', async () => {
    const t = await registerAccount(ctx, 'billTrial2');
    await setSub(t.tenantId, { plan: 'growth', status: 'TRIALING', trialEndsAt: new Date(Date.now() + 2 * day) });
    const lc = ctx.app.get(BillingLifecycle);
    await lc.tick(t.tenantId); await lc.tick(t.tenantId);
    expect(await owned(t.tenantId, 'billing')).toBe(1);
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'ok', phone: '+919877777777' })).status).toBe(201);
  });
});

describe('AI allowance notices', () => {
  it('warns the owner at 95% with the right fix (raise your own limit), once, then says AI is paused for new chats at 100%', async () => {
    const t = await registerAccount(ctx, 'billAiCap');
    await setSub(t.tenantId, { plan: 'growth', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_aicap` });
    const lead = (await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Cap Lead', phone: '+919811100099' })).body.id as string;
    const channel = (await owner.query(`INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at) VALUES (gen_random_uuid(), $1, 'WHATSAPP', 'Cap line', 'ACTIVE', $2, '{}'::jsonb, now()) RETURNING id`, [t.tenantId, `cap-${RUN}`])).rows[0].id as string;
    const conv = (await owner.query(`INSERT INTO conversations (id, tenant_id, channel_id, lead_id, external_thread_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`, [t.tenantId, channel, lead, `t-${RUN}-cap`])).rows[0].id as string;
    const addTokens = (n: number) => owner.query(`INSERT INTO ai_runs (id, tenant_id, conversation_id, status, prompt_version, input_tokens, output_tokens) VALUES (gen_random_uuid(), $1, $2, 'COMPLETED', 'v1.0', $3, 0)`, [t.tenantId, conv, n]);
    const quota = () => owner.query(`SELECT title, body, link FROM notifications WHERE tenant_id=$1 AND type='quota' ORDER BY created_at`, [t.tenantId]).then((r) => r.rows as { title: string; body: string; link: string }[]);
    const usage = async () => (await ctx.http().get('/ai/usage').set(auth(t.accessToken))).body as { cap: number; used: number; capSource: string; level: string };
    const lc = ctx.app.get(BillingLifecycle);

    const { cap, capSource } = await usage();
    expect(capSource).toBe('own'); // the default own cap is tighter than the growth plan allowance, so "raise your limit" is the right advice
    await addTokens(Math.ceil(cap * 0.96));
    await lc.tick(t.tenantId); await lc.tick(t.tenantId);
    let rows = await quota();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'AI tokens: 95% used', link: '/ai-assistant' });
    expect(rows[0]!.body).toMatch(/AI Assistant settings/);

    await addTokens(Math.ceil(cap * 0.1));
    await lc.tick(t.tenantId); await lc.tick(t.tenantId);
    rows = await quota();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ title: 'AI replies are paused for new chats', link: '/ai-assistant' });
    expect(rows[1]!.body).toMatch(/chats the AI is already handling can finish/);
    expect((await usage()).level).toBe('EXCEEDED');
  });
});

describe('plan gating is enforced by the backend', () => {
  it('a feature missing from the plan is refused with 402 (starter has no CSV export; growth does)', async () => {
    const t = await registerAccount(ctx, 'billGate');
    await setSub(t.tenantId, { plan: 'starter', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_gate` });
    const no = await ctx.http().get('/leads/export').set(auth(t.accessToken));
    expect(no.status).toBe(402); expect(no.body.error.code).toBe('feature_not_in_plan');
    await setSub(t.tenantId, { plan: 'growth', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_gate` });
    expect((await ctx.http().get('/leads/export').set(auth(t.accessToken))).status).toBe(200);
  });

  it('seat limits count members plus pending invitations', async () => {
    const t = await registerAccount(ctx, 'billSeats');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
    await setSub(t.tenantId, { plan: 'starter', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_seats` }); // 3 seats
    await addMember(ctx, t, 'billSeatsM1', 'agent');
    await addMember(ctx, t, 'billSeatsM2', 'agent');
    const over = await ctx.http().post('/team/invitations').set(auth(t.accessToken)).send({ email: `it-${RUN}-billseatsx@example.test`, roleKey: 'agent' });
    expect(over.status).toBe(402); expect(over.body.error.code).toBe('quota_exceeded');
    await setSub(t.tenantId, { plan: 'growth', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_seats` });
    expect((await ctx.http().post('/team/invitations').set(auth(t.accessToken)).send({ email: `it-${RUN}-billseatsx@example.test`, roleKey: 'agent' })).status).toBe(201);
  });

  it('active automations are capped by the plan', async () => {
    const t = await registerAccount(ctx, 'billAuto');
    await setSub(t.tenantId, { plan: 'starter', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_auto` }); // 3 active
    const keys = ['welcome_new_lead', 'hot_lead_alert', 'appointment_confirmation', 'appointment_reminder_24h'];
    const ids: string[] = [];
    for (const k of keys) { const c = await ctx.http().post('/automations/from-template').set(auth(t.accessToken)).send({ templateKey: k }); expect(c.status).toBe(201); ids.push(c.body.id as string); }
    for (const id of ids.slice(0, 3)) expect((await ctx.http().post(`/automations/${id}/enable`).set(auth(t.accessToken)).send({ enabled: true })).status).toBe(200);
    const fourth = await ctx.http().post(`/automations/${ids[3]}/enable`).set(auth(t.accessToken)).send({ enabled: true });
    expect(fourth.status).toBe(402); expect(fourth.body.error.code).toBe('quota_exceeded');
    expect((await ctx.http().post(`/automations/${ids[0]}/enable`).set(auth(t.accessToken)).send({ enabled: false })).status).toBe(200);
    expect((await ctx.http().post(`/automations/${ids[3]}/enable`).set(auth(t.accessToken)).send({ enabled: true })).status).toBe(200);
  });

  it('the AI token cap is the tighter of the owner\'s cap and the plan allowance', async () => {
    const t = await registerAccount(ctx, 'billAi');
    await setSub(t.tenantId, { plan: 'starter', status: 'ACTIVE', providerSub: `sub_mock_${RUN}_ai` });
    const u = await ctx.http().get('/ai/usage').set(auth(t.accessToken));
    expect(u.body.cap).toBe(1_000_000); // starter, below the 2M default
  });

  it('a plan without the AI assistant blocks its settings (402), not the rest of the product', async () => {
    const t = await registerAccount(ctx, 'billNoAi');
    await owner.query(`INSERT INTO plans (key, name, price_minor, is_public, updated_at) VALUES ('it_${RUN.slice(0, 4)}_noai', 'No AI', 100, false, now()) ON CONFLICT DO NOTHING`);
    const key = `it_${RUN.slice(0, 4)}_noai`;
    await owner.query(`INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES ${['seats', 'ai_tokens_monthly', 'whatsapp_messages_monthly', 'active_automations', 'knowledge_mb'].map((k) => `('${key}','${k}',true,5)`).join(',')}, ('${key}','ai_assistant',false,NULL),('${key}','automations',true,NULL),('${key}','web_widget',true,NULL),('${key}','csv_export',true,NULL) ON CONFLICT DO NOTHING`);
    await setSub(t.tenantId, { plan: key, status: 'ACTIVE', providerSub: `sub_mock_${RUN}_noai` });
    expect((await ctx.http().get('/ai/assistant').set(auth(t.accessToken))).status).toBe(402);
    expect((await ctx.http().get('/leads').set(auth(t.accessToken))).status).toBe(200);
  });
});

describe('plan changes', () => {
  async function paid(label: string, plan: string, members = 0) {
    const t = await registerAccount(ctx, label);
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
    for (let i = 0; i < members; i++) await addMember(ctx, t, `${label}m${i}`, 'agent');
    await ctx.http().put('/billing/profile').set(auth(t.accessToken)).send(profile('29'));
    await setSub(t.tenantId, { plan, status: 'ACTIVE', providerSub: `sub_mock_${RUN}_${label}`, periodEnd: new Date(Date.now() + 20 * day) });
    return t;
  }

  it('an upgrade applies at once', async () => {
    const t = await paid('billUp', 'starter');
    const r = await ctx.http().post('/billing/change-plan').set(auth(t.accessToken)).send({ planKey: 'growth' });
    expect(r.status).toBe(200); expect(r.body.effective).toBe('now');
    const s = await subRow(t.tenantId);
    expect(s.plan_key).toBe('growth'); expect(s.pending_plan_key).toBeNull();
  });

  it('a downgrade is refused while usage exceeds the target plan, naming what to reduce', async () => {
    const t = await paid('billDown', 'premium', 4); // 5 seats
    const r = await ctx.http().post('/billing/change-plan').set(auth(t.accessToken)).send({ planKey: 'starter' }); // 3 seats
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('over_quota');
    expect(r.body.error.details[0]).toMatchObject({ key: 'seats', used: 5, allowed: 3 });
    expect((await subRow(t.tenantId)).plan_key).toBe('premium');
  });

  it('a downgrade that fits is scheduled for the end of the cycle and applied by the renewal payment', async () => {
    const t = await paid('billDown2', 'premium', 1);
    const r = await ctx.http().post('/billing/change-plan').set(auth(t.accessToken)).send({ planKey: 'growth' });
    expect(r.status).toBe(200); expect(r.body.effective).toBe('cycle_end');
    let s = await subRow(t.tenantId);
    expect(s.plan_key).toBe('premium'); expect(s.pending_plan_key).toBe('growth');
    await hook('charged', `sub_mock_${RUN}_billDown2`, { paymentId: `pay_${RUN}_dd2`, amountMinor: 1179882 });
    s = await subRow(t.tenantId);
    expect(s.plan_key).toBe('growth'); expect(s.pending_plan_key).toBeNull();
  });

  it('cancelling is at the end of the period and is not repeatable', async () => {
    const t = await paid('billCancel', 'growth');
    const r = await ctx.http().post('/billing/cancel').set(auth(t.accessToken)).send({});
    expect(r.status).toBe(200); expect(r.body.cancelAtPeriodEnd).toBe(true);
    expect((await ctx.http().post('/billing/cancel').set(auth(t.accessToken)).send({})).status).toBe(409);
  });
});
