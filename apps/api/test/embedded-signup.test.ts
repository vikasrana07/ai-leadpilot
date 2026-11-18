import { createHash, createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../src/common/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { redact } from '../src/observability/redact.js';
import { MockWhatsAppClient } from '../src/whatsapp/whatsapp.client.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

const APP_SECRET = 'platform-app-secret-for-tests-0123456789';
const VERIFY = 'platform-verify-token-for-tests';
let ctx: TestCtx; let off: TestCtx; let mock: MockWhatsAppClient; let owner$: pg.Pool;
let a: Account; let b: Account;
let seq = 0;
// Phone numbers are unique across ALL workspaces, so every test needs its own digits.
const phone = () => `${(Date.now() % 1e9) * 100 + 8_000_000_000_000_00 + ++seq}`.slice(0, 15);
const waba = () => `${5_000_000 + ++seq}${RUN.replace(/\D/g, '').slice(0, 3)}`.slice(0, 12).padEnd(8, '1');
const body = (o: Partial<{ name: string; code: string; phoneNumberId: string; wabaId: string }> = {}) => ({ name: 'Front desk', code: 'mock-ok-1', phoneNumberId: phone(), wabaId: waba(), ...o });
const connect = (t: Account, o: Parameters<typeof body>[0] = {}) => ctx.http().post('/channels/whatsapp/embedded').set(auth(t.accessToken)).send(body(o));
const rows = async (sql: string, p: unknown[]) => (await owner$.query(sql, p)).rows;

beforeAll(async () => {
  const env = { ...loadEnv(), EMBEDDED_SIGNUP_MODE: 'mock' as const, META_APP_SECRET: APP_SECRET, META_APP_ID: '1234567890', META_WEBHOOK_VERIFY_TOKEN: VERIFY };
  ctx = await createTestApp([{ provide: ENV, useValue: env }]);
  off = await createTestApp(); // default settings: Embedded Signup off
  mock = ctx.app.get(MockWhatsAppClient);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  a = await registerAccount(ctx, 'esA'); b = await registerAccount(ctx, 'esB');
});
afterAll(async () => { await owner$.end(); await off.close(); await ctx.close(); await cleanup(); });

describe('POST /channels/whatsapp/embedded', () => {
  it('is not available while Embedded Signup is off', async () => {
    const acc = await registerAccount(off, 'esOff');
    const r = await off.http().post('/channels/whatsapp/embedded').set(auth(acc.accessToken)).send(body());
    expect(r.status).toBe(404); expect(r.body.error.code).toBe('embedded_signup_disabled');
  });

  it('connects a number: server-side code exchange, WABA check, app subscription, sealed token, no secrets returned', async () => {
    const o = body({ code: 'mock-ok-connect' });
    const before = mock.exchanged.length;
    const r = await ctx.http().post('/channels/whatsapp/embedded').set(auth(a.accessToken)).send(o);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mode: 'platform', phoneNumberId: o.phoneNumberId, wabaId: o.wabaId, status: 'ACTIVE', credentialsSaved: true, webhookUrl: null, verifyToken: null });
    expect(mock.exchanged.slice(before)).toEqual(['mock-ok-connect']); expect(mock.subscribed.has(o.wabaId)).toBe(true);
    const text = JSON.stringify(r.body); expect(text).not.toContain('mock-business-token'); expect(text).not.toContain(APP_SECRET); expect(text).not.toContain('mock-ok-connect');
    // stored sealed: neither the token nor any app secret is readable in the database
    const cred = (await rows('SELECT c.ciphertext, c.wrapped_key, ch.config FROM integration_credentials c JOIN channels ch ON ch.credential_id = c.id WHERE ch.id = $1', [r.body.id]))[0];
    expect(JSON.stringify(cred)).not.toContain('mock-business-token'); expect(JSON.stringify(cred)).not.toContain(APP_SECRET);
    expect(cred.config).toMatchObject({ mode: 'platform', wabaId: o.wabaId });
    expect(await rows("SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_connected_embedded' AND resource_id = $2", [a.tenantId, r.body.id])).toHaveLength(1);
    const list = await ctx.http().get('/channels').set(auth(a.accessToken));
    expect(list.body.find((c: { id: string }) => c.id === r.body.id)).toMatchObject({ mode: 'platform', webhookUrl: null });
  });

  it('rejects a bad code and a number that is not in the WABA, storing and subscribing nothing', async () => {
    const bad = body({ code: 'expired-code' });
    const r1 = await connect(a, bad); expect(r1.status).toBe(400); expect(r1.body.error.code).toBe('embedded_signup_failed');
    expect(JSON.stringify(r1.body)).not.toContain('expired-code');
    const notIn = body(); mock.strictWabas.add(notIn.wabaId);
    const r2 = await connect(a, notIn); expect(r2.status).toBe(400); expect(r2.body.error.code).toBe('embedded_signup_failed');
    expect(mock.subscribed.has(notIn.wabaId)).toBe(false);
    for (const id of [bad.phoneNumberId, notIn.phoneNumberId]) expect(await rows('SELECT 1 FROM channels WHERE external_id = $1', [id])).toHaveLength(0);
    // subscribing can fail too: nothing is stored then either
    const sub = body(); mock.failSubscribe = new (await import('../src/whatsapp/whatsapp.client.js')).WhatsAppApiError('Subscription failed', false, 100);
    expect((await connect(a, sub)).status).toBe(400); expect(await rows('SELECT 1 FROM channels WHERE external_id = $1', [sub.phoneNumberId])).toHaveLength(0);
  });

  it('refuses a number that another workspace owns, before spending the code, and the database enforces it too', async () => {
    const o = body(); expect((await connect(a, o)).status).toBe(201);
    const before = mock.exchanged.length;
    const dup = await connect(b, { ...o, code: 'mock-ok-other' });
    expect(dup.status).toBe(409); expect(dup.body.error.code).toBe('already_connected');
    expect(JSON.stringify(dup.body)).not.toContain(a.tenantId);
    expect(mock.exchanged.length).toBe(before); // the one-time code was never used
    // even a direct insert (a race, or a future code path) cannot create a second owner
    await expect(owner$.query("INSERT INTO channels (tenant_id, type, name, external_id, updated_at) VALUES ($1, 'WHATSAPP', 'dup', $2, now())", [b.tenantId, o.phoneNumberId])).rejects.toThrow(/channels_whatsapp_external_id_key/);
  });

  it('reconnecting the same number in the same workspace refreshes it instead of failing or duplicating', async () => {
    const o = body(); const first = await connect(a, o); expect(first.status).toBe(201);
    const again = await connect(a, { ...o, name: 'Front desk 2', code: 'mock-ok-2' });
    expect(again.status).toBe(201); expect(again.body.id).toBe(first.body.id); expect(again.body.name).toBe('Front desk 2');
    expect(await rows('SELECT 1 FROM channels WHERE external_id = $1', [o.phoneNumberId])).toHaveLength(1);
  });

  it('does not take over a number connected with the workspace\'s own Meta app', async () => {
    const o = body();
    const manual = await ctx.http().post('/channels/whatsapp').set(auth(a.accessToken)).send({ name: 'Own app', phoneNumberId: o.phoneNumberId, wabaId: o.wabaId, accessToken: 'x'.repeat(30), appSecret: 'own-secret-123' });
    expect(manual.status).toBe(201);
    const r = await connect(a, o); expect(r.status).toBe(409); expect(r.body.error.code).toBe('already_connected_manually');
  });

  it('needs the integration permission, validates the body and requires a signed-in user', async () => {
    const owner = await registerAccount(ctx, 'esPerm');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
    const agent = await addMember(ctx, owner, 'esAgent', 'agent');
    expect((await connect(agent)).status).toBe(403);
    expect((await ctx.http().post('/channels/whatsapp/embedded').set(auth(a.accessToken)).send({ name: 'x', code: '1', phoneNumberId: 'abc', wabaId: '1' })).status).toBe(400);
    expect((await ctx.http().post('/channels/whatsapp/embedded').send(body())).status).toBe(401);
  });
});

describe('GET /channels/embedded-signup (what the page needs)', () => {
  it('tells the page the mode, never the app secret, and needs the integration permission', async () => {
    const r = await ctx.http().get('/channels/embedded-signup').set(auth(a.accessToken));
    expect(r.status).toBe(200); expect(r.body).toEqual({ mode: 'mock', appId: null, configId: null, graphVersion: 'v21.0' }); // mock mode: nothing to show Facebook
    expect(JSON.stringify(r.body)).not.toContain(APP_SECRET);
    expect((await off.http().get('/channels/embedded-signup').set(auth((await registerAccount(off, 'esCfgOff')).accessToken))).body.mode).toBe('off');
    expect((await ctx.http().get('/channels/embedded-signup')).status).toBe(401);
    const owner = await registerAccount(ctx, 'esCfgPerm');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
    const agent = await addMember(ctx, owner, 'esCfgAgent', 'agent');
    expect((await ctx.http().get('/channels/embedded-signup').set(auth(agent.accessToken))).status).toBe(403);
  });
  it('in live mode exposes only the public app id and configuration id', async () => {
    const env = { ...loadEnv(), EMBEDDED_SIGNUP_MODE: 'live' as const, WHATSAPP_MODE: 'live' as const, META_APP_ID: '1234567890', META_APP_SECRET: APP_SECRET, META_ES_CONFIG_ID: '9988776655', META_WEBHOOK_VERIFY_TOKEN: VERIFY };
    const { ChannelsService } = await import('../src/channels/channels.module.js');
    const cfg = new (ChannelsService as unknown as new (...a: unknown[]) => { embeddedConfig(): unknown })(null, null, null, null, env).embeddedConfig();
    expect(cfg).toEqual({ mode: 'live', appId: '1234567890', configId: '9988776655', graphVersion: 'v21.0' });
    expect(JSON.stringify(cfg)).not.toContain(APP_SECRET);
  });
});

describe('platform channels: credentials, rotation and disconnect', () => {
  it('uses the platform secret (not a stored one), refuses manual rotation, and tests the connection', async () => {
    const o = body(); const c = await connect(a, o); expect(c.status).toBe(201);
    const { ChannelsService } = await import('../src/channels/channels.module.js');
    const svc = ctx.app.get(ChannelsService);
    const { creds, channel } = await svc.credentialsFor(a.tenantId, c.body.id);
    expect(creds.appSecret).toBe(APP_SECRET); expect(creds.accessToken).toContain('mock-business-token'); expect((channel.config as { mode: string }).mode).toBe('platform');
    const rot = await ctx.http().put(`/channels/${c.body.id}/credentials`).set(auth(a.accessToken)).send({ accessToken: 'y'.repeat(30), appSecret: 'another-secret-1' });
    expect(rot.status).toBe(400); expect(rot.body.error.code).toBe('platform_channel');
    const t = await ctx.http().post(`/channels/${c.body.id}/test`).set(auth(a.accessToken)); expect(t.body.ok).toBe(true);
  });

  it('disconnecting stops message delivery for the WABA, but not while another number of the workspace still uses it', async () => {
    const w = waba(); const p1 = body({ wabaId: w }); const p2 = body({ wabaId: w });
    const c1 = await connect(a, p1); const c2 = await connect(a, p2);
    expect(c1.status).toBe(201); expect(c2.status).toBe(201);
    const n = mock.unsubscribed.length;
    expect((await ctx.http().delete(`/channels/${c1.body.id}`).set(auth(a.accessToken))).status).toBe(204);
    expect(mock.unsubscribed.length).toBe(n); // the second number still needs the subscription
    expect((await ctx.http().delete(`/channels/${c2.body.id}`).set(auth(a.accessToken))).status).toBe(204);
    expect(mock.unsubscribed.slice(n)).toEqual([w]);
    expect((await rows('SELECT status FROM channels WHERE id = $1', [c2.body.id]))[0].status).toBe('DISABLED');
  });

  it('a failed unsubscribe never blocks the disconnect', async () => {
    const c = await connect(a, body()); expect(c.status).toBe(201);
    mock.unsubscribeApp = async () => { throw new Error('Meta is down'); };
    try { expect((await ctx.http().delete(`/channels/${c.body.id}`).set(auth(a.accessToken))).status).toBe(204); }
    finally { mock.unsubscribeApp = MockWhatsAppClient.prototype.unsubscribeApp.bind(mock); }
    expect((await rows('SELECT status FROM channels WHERE id = $1', [c.body.id]))[0].status).toBe('DISABLED');
  });
});

// ---------------------------------------------------------------------------- the platform webhook
const hook = '/webhooks/whatsapp';
const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const waChange = (phoneId: string, from: string, id: string, text = 'hello platform') => ({ field: 'messages', value: { metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: from, profile: { name: 'Pat' } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } });
const envelope = (...changes: unknown[]) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes }] });
const post = (raw: string, sig: string | null = sign(raw)) => { const r = ctx.http().post(hook).set('content-type', 'application/json'); if (sig !== null) r.set('x-hub-signature-256', sig); return r.send(raw); };
const customerNo = () => `91981${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const msgCount = async (tenantId: string, from: string) => (await rows('SELECT count(*)::int n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.tenant_id = $1 AND c.external_thread_id = $2', [tenantId, from]))[0].n as number;

describe('platform webhook: handshake and authenticity', () => {
  it('answers Meta\'s handshake only with the platform verify token, and is invisible while Embedded Signup is off', async () => {
    const ok = await ctx.http().get(hook).query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': 'abc123' });
    expect(ok.status).toBe(200); expect(ok.text).toBe('abc123');
    for (const q of [{ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' }, { 'hub.mode': 'subscribe', 'hub.challenge': 'x' }, { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': 'x' }]) expect((await ctx.http().get(hook).query(q)).status).toBe(403);
    expect((await off.http().get(hook).query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': 'x' })).status).toBe(404);
    expect((await off.http().post(hook).send({})).status).toBe(404);
  });

  it('rejects missing, forged, per-channel-secret and altered-body signatures, storing nothing', async () => {
    const o = body(); const c = await connect(a, o); expect(c.status).toBe(201);
    const from = customerNo(); const raw = envelope(waChange(o.phoneNumberId, from, `wamid.PF${RUN}${++seq}`));
    for (const sig of [null, 'sha256=', 'nope', sign(raw, 'someone-elses-secret'), sign(raw + ' ')]) { const r = await post(raw, sig); expect(r.status, String(sig)).toBe(401); expect(r.body.error.code).toBe('invalid_signature'); }
    expect(await msgCount(a.tenantId, from)).toBe(0);
  });
});

describe('platform webhook: routing and processing', () => {
  it('routes a message to the workspace that owns the number, creating the lead and conversation there only', async () => {
    const oa = body(); const ob = body(); await connect(a, oa); await connect(b, ob);
    const from = customerNo(); const raw = envelope(waChange(oa.phoneNumberId, from, `wamid.PR${RUN}${++seq}`, 'I want a 3 BHK'));
    const r = await post(raw); expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: 'ok', processed: 1, ignored: 0 });
    expect(await msgCount(a.tenantId, from)).toBe(1); expect(await msgCount(b.tenantId, from)).toBe(0);
    expect((await rows("SELECT 1 FROM leads WHERE tenant_id = $1 AND phone_norm LIKE $2", [a.tenantId, `%${from.slice(-10)}`])).length).toBe(1);
  });

  it('one request for two workspaces is split: each stores and processes only its own part', async () => {
    const oa = body(); const ob = body(); await connect(a, oa); await connect(b, ob);
    const fromA = customerNo(); const fromB = customerNo();
    const raw = envelope(waChange(oa.phoneNumberId, fromA, `wamid.PS${RUN}${++seq}`, 'for A'), waChange(ob.phoneNumberId, fromB, `wamid.PS${RUN}${++seq}`, 'for B'));
    const r = await post(raw); expect(r.body).toMatchObject({ status: 'ok', processed: 2 });
    expect(await msgCount(a.tenantId, fromA)).toBe(1); expect(await msgCount(b.tenantId, fromB)).toBe(1);
    expect(await msgCount(a.tenantId, fromB)).toBe(0); expect(await msgCount(b.tenantId, fromA)).toBe(0);
    // the stored delivery of A contains none of B's customer data
    const stored = await rows("SELECT payload FROM webhook_events WHERE tenant_id = $1 AND payload_hash = $2", [a.tenantId, createHash('sha256').update(raw).digest('hex')]);
    expect(stored).toHaveLength(1); expect(JSON.stringify(stored[0].payload)).toContain(fromA); expect(JSON.stringify(stored[0].payload)).not.toContain(fromB);
  });

  it('acknowledges an identical redelivery without processing it twice', async () => {
    const o = body(); await connect(a, o); const from = customerNo();
    const raw = envelope(waChange(o.phoneNumberId, from, `wamid.PD${RUN}${++seq}`));
    expect((await post(raw)).body.status).toBe('ok'); expect((await post(raw)).body.status).toBe('duplicate');
    expect(await msgCount(a.tenantId, from)).toBe(1);
  });

  it('re-processes a delivery whose first attempt died mid-way once it is clearly dead (same recovery as manual channels)', async () => {
    const o = body(); const c = await connect(a, o); const from = customerNo();
    const raw = envelope(waChange(o.phoneNumberId, from, `wamid.PC${RUN}${++seq}`)); const hash = createHash('sha256').update(raw).digest('hex');
    await owner$.query("INSERT INTO webhook_events (id, tenant_id, channel_id, provider, payload_hash, payload, status, created_at) VALUES (gen_random_uuid(), $1, $2, 'whatsapp', $3, '{}', 'received', now())", [a.tenantId, c.body.id, hash]);
    expect((await post(raw)).body.status).toBe('duplicate'); expect(await msgCount(a.tenantId, from)).toBe(0);
    await owner$.query("UPDATE webhook_events SET created_at = now() - interval '5 minutes' WHERE channel_id = $1 AND payload_hash = $2", [c.body.id, hash]);
    expect((await post(raw)).body.status).toBe('ok'); expect(await msgCount(a.tenantId, from)).toBe(1);
  });

  it('ignores unknown numbers, disabled channels, changes without a number, and a manually connected number', async () => {
    const from = customerNo();
    const unknown = await post(envelope(waChange('99999999999999', from, `wamid.PU${RUN}${++seq}`))); expect(unknown.body).toMatchObject({ status: 'ignored', processed: 0, ignored: 1 });
    const o = body(); const c = await connect(a, o); await ctx.http().delete(`/channels/${c.body.id}`).set(auth(a.accessToken));
    expect((await post(envelope(waChange(o.phoneNumberId, from, `wamid.PX${RUN}${++seq}`)))).body.status).toBe('ignored');
    const noPhone = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [] } }] }] });
    expect((await post(noPhone)).body).toMatchObject({ status: 'ignored', ignored: 1 });
    const m = body(); // a manual channel: its number is not served by the platform endpoint
    await ctx.http().post('/channels/whatsapp').set(auth(a.accessToken)).send({ name: 'Own app', phoneNumberId: m.phoneNumberId, wabaId: m.wabaId, accessToken: 'x'.repeat(30), appSecret: 'own-secret-123' });
    const viaPlatform = await post(envelope(waChange(m.phoneNumberId, from, `wamid.PM${RUN}${++seq}`))); expect(viaPlatform.body).toMatchObject({ status: 'ignored', processed: 0 });
    expect(await msgCount(a.tenantId, from)).toBe(0);
    // invalid JSON never reaches the handler (the body parser answers 400, as on every route); a well-formed but foreign payload is ignored
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ object: 'page', entry: [] }))).body.status).toBe('ignored');
  });

  it('keeps the per-channel manual webhook working with ITS OWN secret, and refuses the platform secret there', async () => {
    const o = body(); const own = 'manual-channel-app-secret-123';
    const ch = await ctx.http().post('/channels/whatsapp').set(auth(a.accessToken)).send({ name: 'Own app 2', phoneNumberId: o.phoneNumberId, wabaId: o.wabaId, accessToken: 'z'.repeat(30), appSecret: own });
    const path = new URL(ch.body.webhookUrl).pathname; const from = customerNo();
    const raw = envelope(waChange(o.phoneNumberId, from, `wamid.PO${RUN}${++seq}`));
    const withPlatform = await ctx.http().post(path).set('content-type', 'application/json').set('x-hub-signature-256', sign(raw, APP_SECRET)).send(raw);
    expect(withPlatform.status).toBe(401);
    const withOwn = await ctx.http().post(path).set('content-type', 'application/json').set('x-hub-signature-256', sign(raw, own)).send(raw);
    expect(withOwn.status).toBe(200); expect(withOwn.body.status).toBe('ok'); expect(await msgCount(a.tenantId, from)).toBe(1);
  });
});

describe('find_channel_by_phone_number_id()', () => {
  it('returns only id, workspace, status and mode, and is not callable by PUBLIC', async () => {
    const o = body(); const c = await connect(a, o);
    const r = (await rows('SELECT * FROM find_channel_by_phone_number_id($1)', [o.phoneNumberId]))[0];
    expect(Object.keys(r).sort()).toEqual(['id', 'mode', 'status', 'tenant_id']); expect(r).toMatchObject({ id: c.body.id, tenant_id: a.tenantId, status: 'ACTIVE', mode: 'platform' });
    expect(await rows('SELECT * FROM find_channel_by_phone_number_id($1)', ['00000000'])).toHaveLength(0);
    const priv = (await rows("SELECT has_function_privilege('public', 'find_channel_by_phone_number_id(text)', 'EXECUTE') AS pub, has_function_privilege('leadpilot_app', 'find_channel_by_phone_number_id(text)', 'EXECUTE') AS app", []))[0];
    expect(priv).toEqual({ pub: false, app: true });
  });
});

describe('environment validation', () => {
  const base = { ...process.env, NODE_ENV: 'development', WHATSAPP_MODE: 'mock' } as NodeJS.ProcessEnv;
  const err = (o: Record<string, string | undefined>) => { try { loadEnv({ ...base, ...o }); return null; } catch (e) { return String((e as Error).message); } };
  const live = { EMBEDDED_SIGNUP_MODE: 'live', WHATSAPP_MODE: 'live', META_APP_ID: '123', META_APP_SECRET: 's'.repeat(32), META_ES_CONFIG_ID: '456', META_WEBHOOK_VERIFY_TOKEN: 'v'.repeat(16) };

  it('is off by default and needs nothing', () => { expect(loadEnv({ ...base, EMBEDDED_SIGNUP_MODE: undefined }).EMBEDDED_SIGNUP_MODE).toBe('off'); });
  it('live needs all four Meta values and the live WhatsApp client', () => {
    expect(err(live)).toBeNull();
    for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_ES_CONFIG_ID', 'META_WEBHOOK_VERIFY_TOKEN']) expect(err({ ...live, [k]: '' }), k).toMatch(new RegExp(k));
    expect(err({ ...live, WHATSAPP_MODE: 'mock' })).toMatch(/both be live or both be mock/);
  });
  it('mock needs the app secret (it signs the test webhook) and is refused in production', () => {
    expect(err({ EMBEDDED_SIGNUP_MODE: 'mock', META_APP_SECRET: 'x'.repeat(16) })).toBeNull();
    expect(err({ EMBEDDED_SIGNUP_MODE: 'mock' })).toMatch(/META_APP_SECRET/);
    expect(err({ EMBEDDED_SIGNUP_MODE: 'mock', META_APP_SECRET: 'x'.repeat(16), NODE_ENV: 'production' })).toMatch(/mock Embedded Signup is not allowed in production/);
  });
});

describe('logging', () => {
  it('redacts the platform app secret and business tokens when they appear in a log line', () => {
    const line = redact(`exchange failed client_secret=${'ab12'.repeat(8)} access_token=EAABwzLixnjYBO${'x'.repeat(40)} Authorization: Bearer EAAB${'y'.repeat(40)} META_APP_SECRET=${'cd34'.repeat(8)}`);
    // snake_case names are covered too, even when the value is short or not hex
    expect(redact('client_secret=short-val access_token=abc META_APP_SECRET=xyz refresh-token: q1')).toBe('client_secret=[redacted] access_token=[redacted] META_APP_SECRET=[redacted] refresh-token: [redacted]');
    expect(line).not.toContain('ab12ab12'); expect(line).not.toContain('EAABwzLixnjYBO'); expect(line).not.toContain('EAAByyyy'); expect(line).not.toContain('cd34cd34');
  });
});
