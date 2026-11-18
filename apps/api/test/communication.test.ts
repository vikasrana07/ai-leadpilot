import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalKeyProvider, SecretBox } from '../src/crypto/secret-box.js';
import { WhatsAppApiError, MockWhatsAppClient } from '../src/whatsapp/whatsapp.client.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let mock: MockWhatsAppClient; let owner: Account; let manager: Account; let agent: Account; let other: Account;
let owner$: pg.Pool;
let verifyToken = ''; let channelId = ''; let webhookPath = '';
const APP_SECRET = 'test-app-secret-1234567890';
const PHONE_ID = '109876543210987';
const members: Record<string, string> = {};

const sign = (body: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
let wamidN = 0;
const waText = (from: string, text: string, wamid = `wamid.IN${RUN}${++wamidN}`, phoneId = PHONE_ID) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000', phone_number_id: phoneId }, contacts: [{ wa_id: from, profile: { name: 'Test Customer' } }], messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
const waStatus = (wamid: string, status: string) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '919900000000' }] } }] }] });
const post = (body: string, opts: { path?: string; secret?: string; sig?: string | null } = {}) => {
  const r = ctx.http().post(opts.path ?? webhookPath).set('content-type', 'application/json');
  if (opts.sig !== null) r.set('x-hub-signature-256', opts.sig ?? sign(body, opts.secret));
  return r.send(body);
};
const convos = async (t: Account, q = '') => (await ctx.http().get(`/conversations${q}`).set(auth(t.accessToken))).body;
const findConvo = async (t: Account, phoneDigits: string) => (await convos(t, `?q=${phoneDigits}`)).items[0];

beforeAll(async () => {
  ctx = await createTestApp();
  mock = ctx.app.get(MockWhatsAppClient);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'cmOwner'); other = await registerAccount(ctx, 'cmOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  manager = await addMember(ctx, owner, 'cmManager', 'manager'); agent = await addMember(ctx, owner, 'cmAgent', 'agent');
  const ms = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  for (const m of ms.body) members[m.user.email] = m.id;
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('envelope encryption', () => {
  const box = new SecretBox({ LOCAL_MASTER_KEY: randomBytes(32).toString('base64') } as never);
  it('round-trips, never stores plaintext, and binds ciphertext to its tenant', async () => {
    const sealed = await box.seal({ accessToken: 'EAAG-secret-token' }, 'tenantA:whatsapp');
    expect(JSON.stringify(sealed)).not.toContain('EAAG-secret-token');
    expect(await box.open(sealed, 'tenantA:whatsapp')).toEqual({ accessToken: 'EAAG-secret-token' });
    await expect(box.open(sealed, 'tenantB:whatsapp')).rejects.toThrow(); // copied to another tenant's row
    const raw = Buffer.from(sealed.ciphertext, 'base64'); raw[20] = (raw[20] as number) ^ 1;
    const tampered = { ...sealed, ciphertext: raw.toString('base64') };
    await expect(box.open(tampered, 'tenantA:whatsapp')).rejects.toThrow();
  });
  it('rejects a master key of the wrong length', () => { expect(() => new LocalKeyProvider(Buffer.alloc(16).toString('base64'))).toThrow(); });
});

describe('connecting WhatsApp', () => {
  const body = { name: 'Main line', phoneNumberId: PHONE_ID, wabaId: '208765432109876', accessToken: 'EAAGtestAccessToken1234567890', appSecret: APP_SECRET };
  it('is restricted, validates input and verifies with the provider before saving', async () => {
    expect((await ctx.http().post('/channels/whatsapp').set(auth(agent.accessToken)).send(body)).status).toBe(403);
    expect((await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ ...body, phoneNumberId: 'abc' })).status).toBe(400);
    mock.invalidCredentials = true;
    const bad = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send(body);
    mock.invalidCredentials = false;
    expect(bad.status).toBe(400); expect(bad.body.error.code).toBe('whatsapp_verification_failed');
    expect((await ctx.http().get('/channels').set(auth(owner.accessToken))).body).toHaveLength(0);
  });
  it('stores secrets encrypted and never returns them', async () => {
    const res = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send(body);
    expect(res.status).toBe(201);
    channelId = res.body.id; verifyToken = res.body.verifyToken; webhookPath = new URL(res.body.webhookUrl).pathname;
    expect(JSON.stringify(res.body)).not.toContain(body.accessToken); expect(JSON.stringify(res.body)).not.toContain(APP_SECRET);
    expect(JSON.stringify((await ctx.http().get('/channels').set(auth(owner.accessToken))).body)).not.toContain(body.accessToken);
    const row = await owner$.query('SELECT ciphertext, wrapped_key FROM integration_credentials WHERE tenant_id=$1', [owner.tenantId]);
    expect(row.rows[0].ciphertext).not.toContain(body.accessToken);
    expect(Buffer.from(row.rows[0].ciphertext, 'base64').toString('latin1')).not.toContain('EAAG');
    expect((await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send(body)).status).toBe(409);
    const audit = await ctx.http().get('/audit-logs?action=integration.whatsapp_connected').set(auth(owner.accessToken));
    expect(JSON.stringify(audit.body)).not.toContain(body.accessToken);
    expect(audit.body.items.length).toBe(1);
  });
  it('tests the connection and flags a broken one', async () => {
    expect((await ctx.http().post(`/channels/${channelId}/test`).set(auth(owner.accessToken))).body.ok).toBe(true);
    mock.invalidCredentials = true;
    expect((await ctx.http().post(`/channels/${channelId}/test`).set(auth(owner.accessToken))).body.ok).toBe(false);
    expect((await ctx.http().get('/channels').set(auth(owner.accessToken))).body[0].status).toBe('ERROR');
    mock.invalidCredentials = false;
    expect((await ctx.http().post(`/channels/${channelId}/test`).set(auth(owner.accessToken))).body.ok).toBe(true);
    expect((await ctx.http().get('/channels').set(auth(owner.accessToken))).body[0].status).toBe('ACTIVE');
  });
  it('does not expose another tenant\'s channels', async () => { expect((await ctx.http().get('/channels').set(auth(other.accessToken))).body).toHaveLength(0); expect((await ctx.http().post(`/channels/${channelId}/test`).set(auth(other.accessToken))).status).toBe(404); });
});

describe('webhook handshake and authenticity', () => {
  it('completes Meta\'s verification only with the right token', async () => {
    const ok = await ctx.http().get(`${webhookPath}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=abc123`);
    expect(ok.status).toBe(200); expect(ok.text).toBe('abc123');
    expect((await ctx.http().get(`${webhookPath}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`)).status).toBe(403);
    expect((await ctx.http().get(`/webhooks/whatsapp/${'x'.repeat(32)}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=1`)).status).toBe(403);
    expect((await ctx.http().get(webhookPath)).status).toBe(403);
  });
  it('rejects forged, missing and wrong-secret signatures without storing anything', async () => {
    const before = (await owner$.query('SELECT count(*)::int n FROM messages WHERE tenant_id=$1', [owner.tenantId])).rows[0].n;
    const body = waText('919900000001', 'spoof');
    expect((await post(body, { sig: 'sha256=' + '0'.repeat(64) })).status).toBe(401);
    expect((await post(body, { sig: null })).status).toBe(401);
    expect((await post(body, { sig: 'nope' })).status).toBe(401);
    expect((await post(body, { secret: 'some-other-tenants-secret' })).status).toBe(401);
    expect((await post(body + ' ', { sig: sign(body) })).status).toBe(401); // signature does not match the bytes received
    expect((await post(body, { path: `/webhooks/whatsapp/${'y'.repeat(32)}` })).status).toBe(401);
    expect((await owner$.query('SELECT count(*)::int n FROM messages WHERE tenant_id=$1', [owner.tenantId])).rows[0].n).toBe(before);
  });
  it('another tenant\'s secret cannot post to this tenant\'s webhook', async () => {
    const r = await ctx.http().post('/channels/whatsapp').set(auth(other.accessToken)).send({ name: 'Other line', phoneNumberId: '555000111222333', wabaId: '777000111222333', accessToken: 'EAAGotherTenantToken1234567', appSecret: 'other-tenant-secret-9999' });
    expect(r.status).toBe(201);
    expect((await post(waText('919900000002', 'cross tenant'), { secret: 'other-tenant-secret-9999' })).status).toBe(401);
  });
});

describe('inbound WhatsApp messages', () => {
  it('creates a lead, conversation, message and opt-in consent from an unknown number', async () => {
    const r = await post(waText('919811111111', 'Hi, is the 3BHK available?'));
    expect(r.status).toBe(200); expect(r.body.status).toBe('ok');
    const c = await findConvo(owner, '9811111111');
    expect(c).toMatchObject({ unreadCount: 1, status: 'OPEN', mode: 'HUMAN', channel: { type: 'WHATSAPP' }, preview: 'Hi, is the 3BHK available?', windowOpen: true });
    expect(c.lead.name).toBe('Test Customer');
    const lead = await ctx.http().get(`/leads/${c.lead.id}`).set(auth(owner.accessToken));
    expect(lead.body).toMatchObject({ phone: '+919811111111', source: { key: 'whatsapp' } });
    const detail = await ctx.http().get(`/conversations/${c.id}`).set(auth(owner.accessToken));
    expect(detail.body.whatsappConsent).toBe('OPTED_IN');
    const msgs = await ctx.http().get(`/conversations/${c.id}/messages`).set(auth(owner.accessToken));
    expect(msgs.body.items).toHaveLength(1); expect(msgs.body.items[0]).toMatchObject({ direction: 'INBOUND', senderType: 'CUSTOMER', body: 'Hi, is the 3BHK available?' });
  });
  it('is idempotent: exact redelivery and a re-wrapped copy of the same message id create nothing new', async () => {
    const wamid = `wamid.DUP${RUN}`;
    const body = waText('919822222222', 'only once', wamid);
    expect((await post(body)).body.status).toBe('ok');
    expect((await post(body)).body.status).toBe('duplicate');
    const rewrapped = waText('919822222222', 'only once', wamid).replace('"timestamp":"', '"timestamp":"0') ; // different bytes, same wamid
    await post(rewrapped);
    const c = await findConvo(owner, '9822222222');
    expect((await ctx.http().get(`/conversations/${c.id}/messages`).set(auth(owner.accessToken))).body.items).toHaveLength(1);
    expect(c.unreadCount).toBe(1);
    expect((await ctx.http().get(`/leads?q=9822222222`).set(auth(owner.accessToken))).body.total).toBe(1);
  });
  it('attaches the conversation to an existing lead with the same phone (no duplicate lead)', async () => {
    const lead = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Known Buyer', phone: '98 3333 3333' });
    await post(waText('919833333333', 'hello again'));
    const c = await findConvo(owner, '9833333333');
    expect(c.lead.id).toBe(lead.body.id);
    expect((await ctx.http().get('/leads?q=9833333333').set(auth(owner.accessToken))).body.total).toBe(1);
  });
  it('ignores payloads addressed to a different phone number and malformed bodies', async () => {
    const before = (await ctx.http().get('/conversations?pageSize=100').set(auth(owner.accessToken))).body.total;
    expect((await post(waText('919844444444', 'wrong number', undefined, '999999999999999'))).status).toBe(200);
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ object: 'page', entry: [] }))).status).toBe(200);
    expect((await ctx.http().get('/conversations?pageSize=100').set(auth(owner.accessToken))).body.total).toBe(before);
  });
  it('stores media metadata and proxies the file on demand with safe headers', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: '919855555555', profile: { name: 'Pic Sender' } }], messages: [
      { from: '919855555555', id: `wamid.IMG${RUN}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'Floor plan' } },
      { from: '919855555555', id: `wamid.DOC${RUN}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'document', document: { id: 'MEDIA2', mime_type: 'text/html', filename: '<script>.html' } },
      { from: '919855555555', id: `wamid.STK${RUN}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'sticker' },
    ] } }] }] });
    expect((await post(body)).body.status).toBe('ok');
    const c = await findConvo(owner, '9855555555');
    const msgs = (await ctx.http().get(`/conversations/${c.id}/messages`).set(auth(owner.accessToken))).body.items;
    const img = msgs.find((m: { type: string }) => m.type === 'IMAGE'); const doc = msgs.find((m: { type: string }) => m.type === 'DOCUMENT');
    expect(img).toMatchObject({ body: 'Floor plan', media: { id: 'MEDIA1', mime: 'image/jpeg' } });
    expect(msgs.some((m: { body: string }) => m.body === '[Unsupported message type: sticker]')).toBe(true);
    const f = await ctx.http().get(`/conversations/${c.id}/messages/${img.id}/media`).set(auth(owner.accessToken));
    expect(f.status).toBe(200); expect(f.headers['content-type']).toBe('image/jpeg'); expect(f.headers['x-content-type-options']).toBe('nosniff');
    const d = await ctx.http().get(`/conversations/${c.id}/messages/${doc.id}/media`).set(auth(owner.accessToken));
    expect(d.headers['content-type']).toBe('application/octet-stream'); expect(d.headers['content-disposition']).toContain('attachment'); expect(d.headers['content-disposition']).not.toContain('<');
    expect((await ctx.http().get(`/conversations/${c.id}/messages/${img.id}/media`).set(auth(other.accessToken))).status).toBe(404);
  });
});

describe('message ordering', () => {
  it('orders by server receipt time, so a customer reply in the same second as ours is never treated as older', async () => {
    const phone = '919871234567';
    await post(waText(phone, 'first')); const c = await findConvo(owner, phone.slice(2));
    const sent = await ctx.http().post(`/conversations/${c.id}/messages`).set(auth(owner.accessToken)).send({ text: 'reply right away' });
    expect(sent.status).toBe(201);
    // the customer answers with a provider timestamp (1-second precision) that is EARLIER than our reply's millisecond time
    const stale = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: phone, profile: { name: 'T' } }], messages: [{ from: phone, id: `wamid.ORD${RUN}`, timestamp: String(Math.floor(Date.now() / 1000) - 2), type: 'text', text: { body: 'second' } }] } }] }] });
    await post(stale);
    const msgs = (await ctx.http().get(`/conversations/${c.id}/messages`).set(auth(owner.accessToken))).body.items.map((m: { body: string }) => m.body);
    expect(msgs).toEqual(['first', 'reply right away', 'second']);
  });
});

describe('outbound messaging rules', () => {
  let convoId = ''; const phone = '919866666666';
  beforeAll(async () => { await post(waText(phone, 'hello')); convoId = (await findConvo(owner, phone.slice(2))).id; });
  const send = (t: Account, body: object, id = convoId) => ctx.http().post(`/conversations/${id}/messages`).set(auth(t.accessToken)).send(body);

  it('sends free-form text inside the 24h window and records provider id, status and last-contacted', async () => {
    const r = await send(owner, { text: 'Yes, 3BHK units are available.' });
    expect(r.status).toBe(201); expect(r.body.status).toBe('SENT');
    expect(mock.sent.at(-1)).toMatchObject({ phoneNumberId: PHONE_ID, to: phone, kind: 'text', body: 'Yes, 3BHK units are available.' });
    const lead = await ctx.http().get(`/leads/${(await findConvo(owner, phone.slice(2))).lead.id}`).set(auth(owner.accessToken));
    expect(lead.body.lastContactedAt).not.toBeNull();
    const c = await ctx.http().get(`/conversations/${convoId}`).set(auth(owner.accessToken));
    expect(c.body.unreadCount).toBe(0);
  });
  it('is idempotent on the client key', async () => {
    const n = mock.sent.length;
    const a = await send(owner, { text: 'once only', idempotencyKey: `key-${RUN}-1` }); const b = await send(owner, { text: 'once only', idempotencyKey: `key-${RUN}-1` });
    expect(a.body.id).toBe(b.body.id); expect(mock.sent.length).toBe(n + 1);
  });
  it('tracks delivery and read receipts monotonically', async () => {
    const wamid = mock.sent.at(-1)?.messageId as string;
    await post(waStatus(wamid, 'delivered')); await post(waStatus(wamid, 'read')); await post(waStatus(wamid, 'sent')); await post(waStatus(wamid, 'delivered'));
    const all = (await ctx.http().get(`/conversations/${convoId}/messages`).set(auth(owner.accessToken))).body.items;
    expect(all.find((x: { direction: string; body: string }) => x.direction === 'OUTBOUND' && x.body === 'once only').status).toBe('READ');
  });
  it('blocks free-form text outside the window; templates need registration, correct values and consent', async () => {
    await owner$.query(`UPDATE conversations SET last_inbound_at = now() - interval '25 hours' WHERE id=$1`, [convoId]);
    const t = await send(owner, { text: 'late reply' });
    expect(t.status).toBe(422); expect(t.body.error.code).toBe('outside_window');
    expect((await ctx.http().get(`/conversations/${convoId}`).set(auth(owner.accessToken))).body.windowOpen).toBe(false);
    expect((await send(owner, { template: { name: 'site_visit_reminder', language: 'en', params: ['Asha'] } })).body.error.code).toBe('unknown_template');
    expect((await ctx.http().post('/whatsapp/templates').set(auth(agent.accessToken)).send({ name: 'site_visit_reminder', bodyPreview: 'Hi {{1}}, your visit is on {{2}}' })).status).toBe(403);
    expect((await ctx.http().post('/whatsapp/templates').set(auth(owner.accessToken)).send({ name: 'Bad Name', bodyPreview: 'x' })).status).toBe(400);
    expect((await ctx.http().post('/whatsapp/templates').set(auth(owner.accessToken)).send({ name: 'site_visit_reminder', bodyPreview: 'Hi {{1}}, your visit is on {{2}}' })).status).toBe(201);
    expect((await send(owner, { template: { name: 'site_visit_reminder', language: 'en', params: ['Asha'] } })).body.error.code).toBe('template_params');
    const ok = await send(owner, { template: { name: 'site_visit_reminder', language: 'en', params: ['Asha', 'Saturday'] } });
    expect(ok.status).toBe(201); expect(ok.body.status).toBe('SENT');
    expect(mock.sent.at(-1)).toMatchObject({ kind: 'template', template: { name: 'site_visit_reminder', params: ['Asha', 'Saturday'] } });
    await owner$.query(`UPDATE conversations SET last_inbound_at = now() WHERE id=$1`, [convoId]);
  });
  it('rejects bodies that are both or neither text and template, and oversize text', async () => {
    expect((await send(owner, {})).status).toBe(400);
    expect((await send(owner, { text: 'a', template: { name: 'x', language: 'en', params: [] } })).status).toBe(400);
    expect((await send(owner, { text: 'x'.repeat(5000) })).status).toBe(400);
  });
  it('retries transient provider failures inline, and records permanent failures with a manual retry', async () => {
    mock.failNext = new WhatsAppApiError('Throughput limit', true, 130429);
    const ok = await send(owner, { text: 'after a rate limit' });
    expect(ok.body.status).toBe('SENT');
    mock.failNext = new WhatsAppApiError('Recipient not on WhatsApp', false, 131026);
    const failed = await send(owner, { text: 'will fail' });
    expect(failed.status).toBe(201); expect(failed.body.status).toBe('FAILED'); expect(failed.body.error).toMatchObject({ code: 131026, retryable: false });
    const retried = await ctx.http().post(`/conversations/${convoId}/messages/${failed.body.id}/retry`).set(auth(owner.accessToken));
    expect(retried.body.status).toBe('SENT');
    expect((await ctx.http().post(`/conversations/${convoId}/messages/${retried.body.id}/retry`).set(auth(owner.accessToken))).status).toBe(404); // only failed messages
  });
  it('a provider id that collides with an existing one never turns a delivered message into a failed one, and never shows internals', async () => {
    const dupId = `wamid.DUPLICATE.${RUN}`;
    const orig = mock.sendText.bind(mock);
    mock.sendText = async (...a: Parameters<typeof orig>) => { mock.sent.push({ phoneNumberId: a[0], to: a[2], kind: 'text', body: a[3], messageId: dupId }); return { messageId: dupId }; };
    try {
      const a = await send(owner, { text: 'first with a fixed provider id' }); const b = await send(owner, { text: 'second with the same provider id' });
      expect(a.body.status).toBe('SENT'); expect(b.body.status).toBe('SENT'); expect(b.body.error).toBeNull();
    } finally { mock.sendText = orig; }
  });
  it('honours opt-out: STOP blocks sending until the customer writes again', async () => {
    await post(waText(phone, 'STOP'));
    const blocked = await send(owner, { text: 'are you there?' });
    expect(blocked.status).toBe(422); expect(blocked.body.error.code).toBe('opted_out');
    expect((await ctx.http().get(`/conversations/${convoId}`).set(auth(owner.accessToken))).body.whatsappConsent).toBe('OPTED_OUT');
    await post(waText(phone, 'Actually I do want details'));
    expect((await send(owner, { text: 'Happy to help' })).status).toBe(201);
  });
  it('refuses to send, and ignores inbound events, while the channel is disabled', async () => {
    expect((await ctx.http().delete(`/channels/${channelId}`).set(auth(owner.accessToken))).status).toBe(204);
    const r = await send(owner, { text: 'hello?' });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('channel_unavailable');
    expect((await post(waText('919877700000', 'while disabled'))).body.status).toBe('ignored');
    expect((await ctx.http().get('/leads?q=9877700000').set(auth(owner.accessToken))).body.total).toBe(0);
    expect((await ctx.http().post(`/channels/${channelId}/test`).set(auth(owner.accessToken))).body.ok).toBe(true); // reconnects
    expect((await send(owner, { text: 'back online' })).status).toBe(201);
  });
});

describe('inbox access, assignment and lifecycle', () => {
  let cid = ''; let cid2 = '';
  beforeAll(async () => {
    await post(waText('919877777777', 'agent lead')); await post(waText('919888888888', 'someone elses lead'));
    cid = (await findConvo(owner, '9877777777')).id; cid2 = (await findConvo(owner, '9888888888')).id;
    await ctx.http().post(`/conversations/${cid}/assign`).set(auth(manager.accessToken)).send({ assignedMembershipId: members[agent.email] });
  });
  it('agents only see conversations assigned to them (404 for others), managers see all', async () => {
    const mine = await convos(agent, '?pageSize=100');
    expect(mine.items.map((c: { id: string }) => c.id)).toEqual([cid]);
    for (const path of [`/conversations/${cid2}`, `/conversations/${cid2}/messages`, `/conversations/${cid2}/notes`]) expect((await ctx.http().get(path).set(auth(agent.accessToken))).status).toBe(404);
    expect((await ctx.http().post(`/conversations/${cid2}/messages`).set(auth(agent.accessToken)).send({ text: 'hi' })).status).toBe(404);
    expect((await ctx.http().post(`/conversations/${cid2}/read`).set(auth(agent.accessToken))).status).toBe(404);
    expect((await convos(manager, '?pageSize=100')).items.length).toBeGreaterThanOrEqual(2);
    expect((await ctx.http().post(`/conversations/${cid}/messages`).set(auth(agent.accessToken)).send({ text: 'Hello from your agent' })).status).toBe(201);
  });
  it('only managers can assign; invalid assignees are rejected; other tenants see nothing', async () => {
    expect((await ctx.http().post(`/conversations/${cid}/assign`).set(auth(agent.accessToken)).send({ assignedMembershipId: null })).status).toBe(403);
    expect((await ctx.http().post(`/conversations/${cid}/assign`).set(auth(manager.accessToken)).send({ assignedMembershipId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const otherMember = (await ctx.http().get('/team/members').set(auth(other.accessToken))).body[0].id;
    expect((await ctx.http().post(`/conversations/${cid}/assign`).set(auth(manager.accessToken)).send({ assignedMembershipId: otherMember })).status).toBe(400);
    expect((await convos(other)).total).toBe(0);
    for (const act of ['read', 'close', 'takeover']) expect((await ctx.http().post(`/conversations/${cid}/${act}`).set(auth(other.accessToken))).status).toBe(404);
  });
  it('filters by unread, assignment and status; marks read; closes, and a new inbound message reopens', async () => {
    expect((await convos(manager, '?unread=true')).items.some((c: { id: string }) => c.id === cid2)).toBe(true);
    expect((await ctx.http().post(`/conversations/${cid2}/read`).set(auth(manager.accessToken))).status).toBe(204);
    expect((await convos(manager, '?unread=true')).items.some((c: { id: string }) => c.id === cid2)).toBe(false);
    expect((await convos(manager, '?assigned=unassigned')).items.every((c: { assignee: unknown }) => c.assignee === null)).toBe(true);
    expect((await ctx.http().post(`/conversations/${cid2}/close`).set(auth(manager.accessToken))).status).toBe(204);
    expect((await convos(manager, '?status=CLOSED')).items.map((c: { id: string }) => c.id)).toContain(cid2);
    await post(waText('919888888888', 'following up'));
    expect((await ctx.http().get(`/conversations/${cid2}`).set(auth(manager.accessToken))).body).toMatchObject({ status: 'OPEN', unreadCount: 1 });
  });
  it('supports internal notes (never sent to the customer), tags, takeover and an honest hand-back', async () => {
    const n = mock.sent.length;
    expect((await ctx.http().post(`/conversations/${cid2}/notes`).set(auth(manager.accessToken)).send({ body: 'Budget is flexible' })).status).toBe(201);
    expect((await ctx.http().get(`/conversations/${cid2}/notes`).set(auth(manager.accessToken))).body[0].body).toBe('Budget is flexible');
    expect(mock.sent.length).toBe(n);
    expect((await ctx.http().put(`/conversations/${cid2}/tags`).set(auth(manager.accessToken)).send({ tags: ['VIP', 'vip', 'follow-up'] })).status).toBe(204);
    expect((await ctx.http().get(`/conversations/${cid2}`).set(auth(manager.accessToken))).body.tags).toEqual(['vip', 'follow-up']);
    expect((await ctx.http().post(`/conversations/${cid2}/takeover`).set(auth(manager.accessToken))).status).toBe(204);
    expect((await ctx.http().get(`/conversations/${cid2}`).set(auth(manager.accessToken))).body).toMatchObject({ mode: 'HUMAN', assignee: { name: 'User cmManager' } });
    const hb = await ctx.http().post(`/conversations/${cid2}/handback`).set(auth(manager.accessToken));
    expect(hb.status).toBe(409); expect(hb.body.error.code).toBe('ai_not_configured');
  });
  it('blocks replying while the AI is handling a conversation until a human joins', async () => {
    await owner$.query(`UPDATE conversations SET mode='AI' WHERE id=$1`, [cid2]);
    const r = await ctx.http().post(`/conversations/${cid2}/messages`).set(auth(manager.accessToken)).send({ text: 'hi' });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('join_required');
    await ctx.http().post(`/conversations/${cid2}/takeover`).set(auth(manager.accessToken));
    expect((await ctx.http().post(`/conversations/${cid2}/messages`).set(auth(manager.accessToken)).send({ text: 'hi' })).status).toBe(201);
  });
});

describe('website widget', () => {
  const ORIGIN = 'https://www.skyline-homes.test'; let pk = ''; let token = ''; let convoId = '';
  const w = (m: 'get' | 'post', path: string, origin: string | null = ORIGIN, bearer?: string) => { const r = ctx.http()[m](path); if (origin) r.set('Origin', origin); if (bearer) r.set('authorization', `Bearer ${bearer}`); return r; };

  it('is configured by owners only, and the loader script contains no secrets', async () => {
    const cfg = { allowedOrigins: [ORIGIN, `${ORIGIN}/ignored/path`], color: '#3f55e8', position: 'right', title: 'Chat with Skyline', greeting: 'Welcome!' };
    expect((await ctx.http().put('/widget-config').set(auth(agent.accessToken)).send(cfg)).status).toBe(403);
    expect((await ctx.http().put('/widget-config').set(auth(owner.accessToken)).send({ ...cfg, allowedOrigins: [] })).status).toBe(400);
    expect((await ctx.http().put('/widget-config').set(auth(owner.accessToken)).send({ ...cfg, color: 'red' })).status).toBe(400);
    const res = await ctx.http().put('/widget-config').set(auth(owner.accessToken)).send(cfg);
    expect(res.status).toBe(200); pk = res.body.publicKey;
    expect(pk).toMatch(/^pk_/); expect(res.body.allowedOrigins).toEqual([ORIGIN]);
    const js = await ctx.http().get('/widget.js');
    expect(js.status).toBe(200); expect(js.headers['content-type']).toContain('javascript');
    for (const secret of [process.env.JWT_ACCESS_SECRET as string, APP_SECRET, 'accessToken']) expect(js.text).not.toContain(secret);
    expect(js.text).not.toContain('innerHTML = m'); // visitor text is rendered with textContent only
    // replies must reach a visitor whose chat tab is in the background: polling never stops while hidden, and resumes at once on return
    expect(js.text).toContain('visibilitychange'); expect(js.text).not.toMatch(/if \(!document\.hidden\) poll\(\)/); expect(js.text).toContain('document.hidden ? 8000 : 2000');
  });
  it('serves config only to allow-listed origins', async () => {
    expect((await w('get', `/widget/config?key=${pk}`)).body).toMatchObject({ enabled: true, title: 'Chat with Skyline', color: '#3f55e8' });
    expect((await w('get', `/widget/config?key=${pk}`, 'https://evil.example')).status).toBe(403);
    expect((await w('get', `/widget/config?key=${pk}`, null)).status).toBe(403);
    expect((await w('get', `/widget/config?key=pk_doesnotexist12345`)).status).toBe(404);
    expect((await w('get', `/widget/config?key=<script>`)).status).toBe(404);
  });
  it('sets CORS for widget endpoints but not for the private API', async () => {
    const pre = await ctx.http().options('/widget/messages').set('Origin', 'https://anything.example').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(pre.headers['access-control-allow-origin']).toBe('https://anything.example'); expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
    const priv = await ctx.http().options('/leads').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(priv.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
  it('starts a session that creates a lead and conversation, validating contact details and origin', async () => {
    expect((await w('post', '/widget/sessions').send({ key: pk, name: 'No Contact' })).status).toBe(400);
    expect((await w('post', '/widget/sessions').send({ key: pk, name: 'Bad Phone', phone: '12' })).status).toBe(400);
    expect((await w('post', '/widget/sessions', 'https://evil.example').send({ key: pk, name: 'Evil', phone: '9890000001' })).status).toBe(403);
    const r = await w('post', '/widget/sessions').send({ key: pk, name: 'Web Visitor', phone: '98900 00002' });
    expect(r.status).toBe(201); token = r.body.token;
    const c = await findConvo(owner, '9890000002'); convoId = c.id;
    expect(c).toMatchObject({ channel: { type: 'WEB_WIDGET' }, lead: { name: 'Web Visitor' } });
    expect((await ctx.http().get(`/leads/${c.lead.id}`).set(auth(owner.accessToken))).body.source.key).toBe('website_widget');
  });
  it('exchanges messages with the team, and visitors only see their own session', async () => {
    expect((await w('post', '/widget/messages', ORIGIN, token).send({ text: 'Do you have 2BHK in Baner?' })).status).toBe(201);
    expect((await w('post', '/widget/messages', ORIGIN, token).send({ text: '' })).status).toBe(400);
    const inbox = await ctx.http().get(`/conversations/${convoId}/messages`).set(auth(owner.accessToken));
    expect(inbox.body.items.at(-1)).toMatchObject({ direction: 'INBOUND', body: 'Do you have 2BHK in Baner?' });
    expect((await ctx.http().post(`/conversations/${convoId}/messages`).set(auth(owner.accessToken)).send({ text: 'Yes! Shall I share the options?' })).body.status).toBe('DELIVERED');
    const mine = await w('get', '/widget/messages', ORIGIN, token);
    expect(mine.body.items.map((m: { from: string; text: string }) => `${m.from}:${m.text}`)).toEqual(['visitor:Do you have 2BHK in Baner?', 'team:Yes! Shall I share the options?']);
    // a second visitor opening a session with the SAME contact cannot read the earlier history
    const again = await w('post', '/widget/sessions').send({ key: pk, name: 'Impersonator', phone: '9890000002' });
    expect((await w('get', '/widget/messages', ORIGIN, again.body.token)).body.items).toEqual([]);
    expect((await ctx.http().get('/leads?q=9890000002').set(auth(owner.accessToken))).body.total).toBe(1);
  });
  it('rejects tampered tokens, wrong origins, and tokens after the key is rotated or the widget disabled', async () => {
    expect((await w('get', '/widget/messages', ORIGIN, token.slice(0, -3) + 'abc')).status).toBe(401);
    expect((await w('get', '/widget/messages', ORIGIN)).status).toBe(401);
    expect((await w('get', '/widget/messages', 'https://evil.example', token)).status).toBe(403);
    expect((await w('post', '/widget/messages', 'https://evil.example', token).send({ text: 'x' })).status).toBe(403);
    const ownerSessionAsWidget = await w('get', '/widget/messages', ORIGIN, owner.accessToken);
    expect(ownerSessionAsWidget.status).toBe(401);
    expect((await ctx.http().post('/widget-config/rotate-key').set(auth(agent.accessToken))).status).toBe(403);
    const rot = await ctx.http().post('/widget-config/rotate-key').set(auth(owner.accessToken));
    expect(rot.body.publicKey).not.toBe(pk);
    expect((await w('get', '/widget/messages', ORIGIN, token)).status).toBe(401);
    expect((await w('get', `/widget/config?key=${pk}`)).status).toBe(404);
    await ctx.http().put('/widget-config').set(auth(owner.accessToken)).send({ allowedOrigins: [ORIGIN], enabled: false });
    expect((await w('post', '/widget/sessions').send({ key: rot.body.publicKey, name: 'X', phone: '9890000003' })).status).toBe(404);
  });
  it('keeps another tenant\'s widget separate', async () => {
    const r = await ctx.http().get('/widget-config').set(auth(other.accessToken)); expect(r.status).toBe(200); expect(Object.keys(r.body)).toHaveLength(0);
  });
});

describe('real-time delivery (SSE over Redis)', () => {
  it('pushes new messages to connected managers but not to agents who do not own the conversation', async () => {
    const server = await ctx.app.listen(0); const port = (server.address() as AddressInfo).port;
    const open = (t: Account) => { const events: string[] = []; const req = http.get({ port, path: '/realtime/stream', headers: { authorization: `Bearer ${t.accessToken}` } }, (res) => { res.on('data', (d: Buffer) => events.push(d.toString())); }); return { events, close: () => req.destroy() }; };
    const mgr = open(manager); const ag = open(agent); const stranger = open(other);
    await new Promise((r) => setTimeout(r, 600));
    await post(waText('919899999999', 'live message'));
    await new Promise((r) => setTimeout(r, 800));
    const text = (e: string[]) => e.join('');
    expect(text(mgr.events)).toContain('event: message.created');
    expect(text(ag.events)).not.toContain('message.created'); // conversation is unassigned/not theirs
    expect(text(stranger.events)).not.toContain('message.created');
    for (const c of [mgr, ag, stranger]) c.close();
    const unauth = await new Promise<number>((resolve) => { http.get({ port, path: '/realtime/stream' }, (res) => { resolve(res.statusCode ?? 0); res.destroy(); }); });
    expect(unauth).toBe(401);
  });
});
