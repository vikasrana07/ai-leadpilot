import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectPromise } from '../src/conversations/promise-tracker.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

describe('detectPromise (unit)', () => {
  const now = new Date('2026-11-27T10:00:00.000Z');

  it('detects English commitment with deliverable and clock time', () => {
    const p = detectPromise("Sure, I'll send you the 3BHK brochure by 5 PM today", now);
    expect(p).not.toBeNull();
    expect(p!.title).toBe('Promise: Share brochure');
    expect(p!.suggestedFollowUp).toContain('brochure');
    expect(p!.dueAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('detects Hinglish commitment with tomorrow/kal', () => {
    const p = detectPromise('Main kal subah floor plan bhejta hoon sir', now);
    expect(p).not.toBeNull();
    expect(p!.title).toBe('Promise: Send floor plan');
    expect(p!.dueAt.getDate()).toBe(now.getDate() + 1);
  });

  it('returns null for normal messages without commitments', () => {
    expect(detectPromise('Thanks for visiting our site today!', now)).toBeNull();
  });
});

let ctx: TestCtx;
let owner: Account;
let other: Account;
const APP_SECRET = 'promise-test-secret-123456';
const PHONE_ID = `77${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
let hook = '';
let n = 0;

const inbound = async (from: string, text: string) => {
  const b = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_ID },
          contacts: [{ wa_id: from, profile: { name: 'Promise Visitor' } }],
          messages: [{ from, id: `wamid.PR${RUN}${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
        },
      }],
    }],
  });
  await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(b).digest('hex')}`).send(b);
};

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'prOwner');
  other = await registerAccount(ctx, 'prOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({
    name: 'Promise line',
    phoneNumberId: PHONE_ID,
    wabaId: `78${PHONE_ID.slice(2)}`,
    accessToken: 'EAAGpromiseToken12345678901234',
    appSecret: APP_SECRET,
  });
  hook = new URL(ch.body.webhookUrl).pathname;
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('Promise-Tracker API integration', () => {
  it('auto-captures a promise task on outbound reply, lists it, and completes it with tenant isolation', async () => {
    const from = `919830${String(parseInt(RUN, 16) % 1000000).padStart(6, '0')}`;
    await inbound(from, 'Can you share the quote?');

    const list = await ctx.http().get(`/conversations?q=${from.slice(2)}&pageSize=5`).set(auth(owner.accessToken));
    const convoId = list.body.items[0].id as string;

    // Takeover so agent can reply
    await ctx.http().post(`/conversations/${convoId}/takeover`).set(auth(owner.accessToken));

    const sendRes = await ctx.http()
      .post(`/conversations/${convoId}/messages`)
      .set(auth(owner.accessToken))
      .send({ text: "Sure, I'll share the quote in 30 minutes.", idempotencyKey: `pr-${RUN}-1` });
    expect(sendRes.status).toBe(201);

    const promisesRes = await ctx.http().get(`/conversations/${convoId}/promises`).set(auth(owner.accessToken));
    expect(promisesRes.status).toBe(200);
    expect(promisesRes.body.length).toBe(1);
    expect(promisesRes.body[0].title).toBe('Promise: Send pricing / quote');
    expect(promisesRes.body[0].suggestedFollowUp).toContain('pricing');

    // Cross-tenant isolation check
    const otherRes = await ctx.http().get(`/conversations/${convoId}/promises`).set(auth(other.accessToken));
    expect(otherRes.status).toBe(404);

    // Complete promise
    const doneRes = await ctx.http()
      .post(`/conversations/${convoId}/promises/${promisesRes.body[0].id}/complete`)
      .set(auth(owner.accessToken));
    expect(doneRes.status).toBe(200);

    const afterRes = await ctx.http().get(`/conversations/${convoId}/promises`).set(auth(owner.accessToken));
    expect(afterRes.body.length).toBe(0);
  });
});
