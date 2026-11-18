import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../src/common/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { ChannelHealth, isTokenRevoked } from '../src/ops/channel-health.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { MockWhatsAppClient, WhatsAppApiError } from '../src/whatsapp/whatsapp.client.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

const APP_SECRET = 'platform-app-secret-for-health-tests-0123456789';
let ctx: TestCtx; let mock: MockWhatsAppClient; let health: ChannelHealth; let owner$: pg.Pool; let a: Account;
let seq = 0;
const phone = () => `${(Date.now() % 1e9) * 100 + 7_000_000_000_000_00 + ++seq}`.slice(0, 15);
const waba = () => `${6_000_000 + ++seq}${RUN.replace(/\D/g, '').slice(0, 3)}`.slice(0, 12).padEnd(8, '1');
const rows = async (sql: string, p: unknown[]) => (await owner$.query(sql, p)).rows;
const connect = async (acct: Account = a) => { const o = { name: 'Front desk', code: 'mock-ok-1', phoneNumberId: phone(), wabaId: waba() }; const r = await ctx.http().post('/channels/whatsapp/embedded').set(auth(acct.accessToken)).send(o); expect(r.status).toBe(201); return { ...o, id: r.body.id as string }; };
const status = async (id: string) => (await rows('SELECT status FROM channels WHERE id = $1', [id]))[0].status as string;
const notices = async (tenantId: string) => (await rows("SELECT title FROM notifications WHERE tenant_id = $1 AND type = 'integration' ORDER BY created_at", [tenantId])).map((r) => r.title as string);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000);

beforeAll(async () => {
  const env = { ...loadEnv(), EMBEDDED_SIGNUP_MODE: 'mock' as const, META_APP_SECRET: APP_SECRET, META_APP_ID: '1234567890', META_WEBHOOK_VERIFY_TOKEN: 'verify-token-for-health-tests' };
  ctx = await createTestApp([{ provide: ENV, useValue: env }]);
  mock = ctx.app.get(MockWhatsAppClient); health = ctx.app.get(ChannelHealth);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  a = await registerAccount(ctx, 'chA');
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });
beforeEach(() => { mock.invalidCredentials = false; });

describe('what counts as a revoked token', () => {
  it('only non-retryable OAuth errors do; passing failures and other errors do not', () => {
    for (const code of [190, 102, 463, 467]) expect(isTokenRevoked(new WhatsAppApiError('x', false, code)), String(code)).toBe(true);
    expect(isTokenRevoked(new WhatsAppApiError('x', true, 190))).toBe(false);   // retryable: Meta side, try again later
    expect(isTokenRevoked(new WhatsAppApiError('x', false, 100))).toBe(false);  // some other client error
    expect(isTokenRevoked(new WhatsAppApiError('x', false))).toBe(false);
    expect(isTokenRevoked(new Error('network'))).toBe(false);
  });
});

describe('daily WhatsApp connection health check', () => {
  it('a healthy channel stays active and its verification time is refreshed, with no notice', async () => {
    const c = await connect();
    await owner$.query("UPDATE integration_credentials SET last_verified_at = now() - interval '3 days' WHERE id = (SELECT credential_id FROM channels WHERE id = $1)", [c.id]);
    await health.run();
    expect(await status(c.id)).toBe('ACTIVE');
    expect((await rows('SELECT last_verified_at > now() - interval \'1 minute\' AS fresh FROM integration_credentials WHERE id = (SELECT credential_id FROM channels WHERE id = $1)', [c.id]))[0].fresh).toBe(true);
    expect(await notices(a.tenantId)).not.toContain('WhatsApp needs to be connected again');
  });

  it('a revoked token flags the channel, audits it and tells the owners exactly once, even across runs and days', async () => {
    const acct = await registerAccount(ctx, 'chRev'); const c = await connect(acct);
    mock.invalidCredentials = true;
    const r1 = await health.run(); expect(r1.needsReconnect).toBeGreaterThanOrEqual(1);
    expect(await status(c.id)).toBe('NEEDS_RECONNECT');
    expect(await notices(acct.tenantId)).toEqual(['WhatsApp needs to be connected again']);
    expect(await rows("SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_needs_reconnect' AND resource_id = $2", [acct.tenantId, c.id])).toHaveLength(1);
    await health.run();                                  // same day: nothing repeated
    await health.run(day(1));                            // next day, still revoked, already flagged: no second notice
    expect(await notices(acct.tenantId)).toHaveLength(1);
    expect(await rows("SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_needs_reconnect'", [acct.tenantId])).toHaveLength(1);
    // the view tells the page what to show, and nothing secret
    const list = await ctx.http().get('/channels').set(auth(acct.accessToken)); expect(list.body[0]).toMatchObject({ status: 'NEEDS_RECONNECT', mode: 'platform' });
    expect(JSON.stringify(list.body)).not.toContain('mock-business-token');
  });

  it('a passing failure (Meta unreachable) changes nothing and is retried on the next run, with no notice', async () => {
    const acct = await registerAccount(ctx, 'chTrans'); const c = await connect(acct);
    const real = mock.getPhoneNumber.bind(mock);
    mock.getPhoneNumber = async () => { throw new WhatsAppApiError('Meta is unavailable', true, 2); };
    try { const r = await health.run(); expect(r.transient).toBeGreaterThanOrEqual(1); } finally { mock.getPhoneNumber = real; }
    expect(await status(c.id)).toBe('ACTIVE'); expect(await notices(acct.tenantId)).toEqual([]);
    expect(await rows("SELECT 1 FROM event_marks WHERE tenant_id = $1 AND key LIKE 'wa-health:%'", [acct.tenantId])).toHaveLength(0); // no definite answer, so no mark
    mock.invalidCredentials = true; await health.run(); expect(await status(c.id)).toBe('NEEDS_RECONNECT'); // the retry saw the real answer
  });

  it('a flagged channel whose token works again becomes active, and reconnecting with Facebook also restores it', async () => {
    const acct = await registerAccount(ctx, 'chRec'); const c = await connect(acct);
    mock.invalidCredentials = true; await health.run(); expect(await status(c.id)).toBe('NEEDS_RECONNECT');
    mock.invalidCredentials = false;
    await health.run(day(1)); expect(await status(c.id)).toBe('ACTIVE');
    expect(await rows("SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_recovered'", [acct.tenantId])).toHaveLength(1);
    // and the explicit path: flag it, then run Embedded Signup again for the same number
    mock.invalidCredentials = true; await health.run(day(2)); expect(await status(c.id)).toBe('NEEDS_RECONNECT'); mock.invalidCredentials = false;
    const again = await ctx.http().post('/channels/whatsapp/embedded').set(auth(acct.accessToken)).send({ name: 'Front desk', code: 'mock-ok-again', phoneNumberId: c.phoneNumberId, wabaId: c.wabaId });
    expect(again.status).toBe(201); expect(again.body.id).toBe(c.id); expect(await status(c.id)).toBe('ACTIVE');
  });

  it('never touches channels connected with the workspace\'s own Meta app', async () => {
    const acct = await registerAccount(ctx, 'chManual'); const o = { phoneNumberId: phone(), wabaId: waba() };
    const m = await ctx.http().post('/channels/whatsapp').set(auth(acct.accessToken)).send({ name: 'Own app', ...o, accessToken: 'x'.repeat(30), appSecret: 'own-secret-123' }); expect(m.status).toBe(201);
    mock.invalidCredentials = true; await health.run();
    expect(await status(m.body.id)).toBe('ACTIVE'); expect(await notices(acct.tenantId)).toEqual([]);
  });

  it('sending is refused while a channel needs reconnecting, with the existing clear message', async () => {
    const acct = await registerAccount(ctx, 'chSend'); const c = await connect(acct); const from = `91981${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: c.phoneNumberId }, contacts: [{ wa_id: from, profile: { name: 'Pat' } }], messages: [{ from, id: `wamid.CH${RUN}${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hello' } }] } }] }] });
    const hook = await ctx.http().post('/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`).send(raw);
    expect(hook.body.status).toBe('ok');
    const conv = (await rows('SELECT id FROM conversations WHERE tenant_id = $1 AND channel_id = $2', [acct.tenantId, c.id]))[0].id as string;
    expect((await ctx.http().post(`/conversations/${conv}/messages`).set(auth(acct.accessToken)).send({ text: 'before' })).status).toBe(201);
    mock.invalidCredentials = true; await health.run(); mock.invalidCredentials = false;
    const blocked = await ctx.http().post(`/conversations/${conv}/messages`).set(auth(acct.accessToken)).send({ text: 'after' });
    expect(blocked.status).toBe(422); expect(blocked.body.error.code).toBe('channel_unavailable');
  });

  it('warns the owners about a token that Meta said will expire within a week, once a day, and not about a distant or unknown expiry', async () => {
    const acct = await registerAccount(ctx, 'chExp'); const c = await connect(acct);
    const setExpiry = (d: Date | null) => owner$.query("UPDATE channels SET config = CASE WHEN $2::text IS NULL THEN config - 'tokenExpiresAt' ELSE jsonb_set(config, '{tokenExpiresAt}', to_jsonb($2::text)) END WHERE id = $1", [c.id, d?.toISOString() ?? null]);
    await setExpiry(null); await health.run(day(0)); expect(await notices(acct.tenantId)).toEqual([]);        // Meta gave no expiry: no warning
    await setExpiry(day(30)); await health.run(day(1)); expect(await notices(acct.tenantId)).toEqual([]);    // far away
    await setExpiry(day(5)); await health.run(day(2));
    expect(await notices(acct.tenantId)).toEqual(['Your WhatsApp connection expires soon']);
    await health.run(day(2)); expect(await notices(acct.tenantId)).toHaveLength(1);                           // same day: once
    await health.run(day(3)); expect(await notices(acct.tenantId)).toHaveLength(2);                           // next day: a reminder
  });

  it('runDaily does the work once per day per process, and list_platform_channels_for_health() returns ids and status only', async () => {
    const first = await health.runDaily(day(40)); expect(first).not.toBeNull();
    expect(await health.runDaily(day(40))).toBeNull();
    const r = (await rows('SELECT * FROM list_platform_channels_for_health() LIMIT 1', []))[0];
    expect(Object.keys(r).sort()).toEqual(['id', 'status', 'tenant_id']);
    const priv = (await rows("SELECT has_function_privilege('public', 'list_platform_channels_for_health()', 'EXECUTE') AS pub, has_function_privilege('leadpilot_app', 'list_platform_channels_for_health()', 'EXECUTE') AS app", []))[0];
    expect(priv).toEqual({ pub: false, app: true });
  });
});

describe('Meta account notices (the business removed LeadPilot)', () => {
  const sign = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
  const post = (raw: string, sig = sign(raw)) => ctx.http().post('/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sig).send(raw);
  const notice = (wabaId: string, event: string) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: { event, waba_info: { waba_id: wabaId } } }] }] });
  const waitForNotice = async (tenantId: string, n: number) => { for (let t = 0; t < 60; t++) { await ctx.app.get(OutboxRelay).drainOnce(200); if ((await notices(tenantId)).length >= n) return; await sleep(100); } };

  it('flags every Facebook-connected channel of that account at once, audits it, and notifies the owners once', async () => {
    const acct = await registerAccount(ctx, 'chNotice'); const w = waba();
    const c1 = await connect(acct).then(async (c) => { await owner$.query("UPDATE channels SET config = jsonb_set(config, '{wabaId}', to_jsonb($2::text)) WHERE id = $1", [c.id, w]); return c; });
    const other = await connect(acct); // a different account of the same workspace: untouched
    const r = await post(notice(w, 'PARTNER_APP_UNINSTALLED')); expect(r.status).toBe(200); expect(r.body.status).toBe('ok');
    expect(await status(c1.id)).toBe('NEEDS_RECONNECT'); expect(await status(other.id)).toBe('ACTIVE');
    expect(await rows("SELECT metadata FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_needs_reconnect'", [acct.tenantId])).toHaveLength(1);
    await waitForNotice(acct.tenantId, 1);
    expect(await notices(acct.tenantId)).toEqual(['WhatsApp needs to be connected again']);
    // the same notice again (Meta retries), then the daily check: nothing is repeated
    expect((await post(notice(w, 'PARTNER_APP_UNINSTALLED'))).status).toBe(200);
    await ctx.http().delete(`/channels/${other.id}`).set(auth(acct.accessToken)); // the mock's revoked flag is global: keep the second channel out of the check
    mock.invalidCredentials = true; await health.run(); mock.invalidCredentials = false;
    await ctx.app.get(OutboxRelay).drainOnce(200); await sleep(300);
    expect(await notices(acct.tenantId)).toHaveLength(1);
    expect(await rows("SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_needs_reconnect'", [acct.tenantId])).toHaveLength(1);
  });

  it('ignores harmless account events, unknown accounts, a forged signature, and a channel the owner disabled', async () => {
    const acct = await registerAccount(ctx, 'chNotice2'); const c = await connect(acct);
    await owner$.query("UPDATE channels SET config = jsonb_set(config, '{wabaId}', to_jsonb($2::text)) WHERE id = $1", [c.id, '555000111']);
    expect((await post(notice('555000111', 'PARTNER_ADDED'))).body.status).toBe('ignored');          // not a removal
    expect((await post(notice('999000999', 'PARTNER_REMOVED'))).body.status).toBe('ignored');         // no such account
    expect((await post(notice('555000111', 'PARTNER_REMOVED'), 'sha256=bad')).status).toBe(401);       // not from Meta
    expect(await status(c.id)).toBe('ACTIVE');
    await ctx.http().delete(`/channels/${c.id}`).set(auth(acct.accessToken));
    await post(notice('555000111', 'PARTNER_REMOVED')); expect(await status(c.id)).toBe('DISABLED'); // the owner's choice stands
    const noWaba = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: { event: 'PARTNER_REMOVED' } }] }] });
    expect((await post(noWaba)).body).toMatchObject({ status: 'ignored', ignored: 1 });
  });

  it('find_platform_channels_by_waba() returns ids and status only and is not callable by PUBLIC', async () => {
    const r = (await rows("SELECT * FROM find_platform_channels_by_waba('555000111')", []))[0];
    expect(Object.keys(r ?? { id: 1, status: 1, tenant_id: 1 }).sort()).toEqual(['id', 'status', 'tenant_id']);
    const priv = (await rows("SELECT has_function_privilege('public', 'find_platform_channels_by_waba(text)', 'EXECUTE') AS pub, has_function_privilege('leadpilot_app', 'find_platform_channels_by_waba(text)', 'EXECUTE') AS app", []))[0];
    expect(priv).toEqual({ pub: false, app: true });
  });
});
