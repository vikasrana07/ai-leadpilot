import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'msOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('messenger & instagram channels', () => {
  it('connects an Instagram channel, verifies webhook challenge, and ingests signed DM', async () => {
    const appSecret = 'meta-social-secret-123456';
    const conn = await ctx
      .http()
      .post('/channels/meta-social')
      .set(auth(owner.accessToken))
      .send({
        type: 'INSTAGRAM',
        name: 'LeadPilot IG',
        externalId: 'ig_page_999',
        accessToken: 'EAAGsocialToken1234567890',
        appSecret,
      });
    expect(conn.status).toBe(201);
    const { webhookPath, verifyToken } = conn.body as { webhookPath: string; verifyToken: string };

    // Challenge verification
    const chal = await ctx
      .http()
      .get(webhookPath)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': 'chal_123' });
    expect(chal.status).toBe(200);
    expect(chal.text).toBe('chal_123');

    // Signed inbound DM
    const payload = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'ig_page_999',
          messaging: [
            {
              sender: { id: 'igsid_user_42' },
              timestamp: Date.now(),
              message: { mid: `mid.${Date.now()}`, text: 'Hi, is the 3BHK available?' },
            },
          ],
        },
      ],
    });
    const sig = `sha256=${createHmac('sha256', appSecret).update(payload).digest('hex')}`;

    const hook = await ctx
      .http()
      .post(webhookPath)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(payload);
    expect(hook.status).toBe(200);
    expect(hook.body).toMatchObject({ ok: true, processed: 1 });

    // Forged signature rejected
    const bad = await ctx
      .http()
      .post(webhookPath)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(payload);
    expect(bad.status).toBe(400);
  });
});
