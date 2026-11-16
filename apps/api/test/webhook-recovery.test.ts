import { createHash, createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

/** A crash between "webhook recorded" and "webhook processed" must not lose the customer's message when Meta redelivers it. */
let ctx: TestCtx; let owner$: pg.Pool; let t: Account;
const SECRET = 'recover-secret-123456'; const PHONE_ID = `75${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
let hook = '';
const payload = (from: string, id: string) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: from, profile: { name: 'Recover' } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'please do not lose me' } }] } }] }] });
const post = (b: string) => ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', SECRET).update(b).digest('hex')}`).send(b);
const msgCount = async (from: string) => (await owner$.query(`SELECT count(*)::int n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.tenant_id = $1 AND c.external_thread_id = $2`, [t.tenantId, from])).rows[0].n as number;

beforeAll(async () => {
  ctx = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  t = await registerAccount(ctx, 'recOwner');
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(t.accessToken)).send({ name: 'Rec line', phoneNumberId: PHONE_ID, wabaId: `76${PHONE_ID.slice(2)}`, accessToken: 'EAAGrecToken123456789012345', appSecret: SECRET });
  hook = new URL(ch.body.webhookUrl).pathname;
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('webhook crash recovery', () => {
  it('re-processes a redelivery whose first attempt died mid-way, but not one still in flight or already done', async () => {
    const from = `91970${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const body = payload(from, `wamid.REC${RUN}1`);
    const chan = (await owner$.query('SELECT id FROM channels WHERE tenant_id = $1 LIMIT 1', [t.tenantId])).rows[0].id as string;
    // simulate the crash: the event row exists, status 'received', and the message was never ingested
    await owner$.query(`INSERT INTO webhook_events (id, tenant_id, channel_id, provider, payload_hash, payload, status, created_at) VALUES (gen_random_uuid(), $1, $2, 'whatsapp', $3, '{}', 'received', now())`, [t.tenantId, chan, createHash('sha256').update(body).digest('hex')]);
    // a redelivery moments later could still be the first attempt in flight: not re-run
    expect((await post(body)).body.status).toBe('duplicate'); expect(await msgCount(from)).toBe(0);
    // once the first attempt is clearly dead, Meta's retry is processed and the message arrives
    await owner$.query(`UPDATE webhook_events SET created_at = now() - interval '5 minutes' WHERE tenant_id = $1 AND payload_hash = $2`, [t.tenantId, createHash('sha256').update(body).digest('hex')]);
    expect((await post(body)).body.status).toBe('ok'); expect(await msgCount(from)).toBe(1);
    // and from then on it is a normal duplicate, with exactly one stored message
    expect((await post(body)).body.status).toBe('duplicate'); expect(await msgCount(from)).toBe(1);
  });
});
