import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptWebPushPayload } from '../src/ops/web-push.service.js';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'pushOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('web push', () => {
  it('encrypts payloads per RFC 8291 (aes128gcm)', () => {
    const clientEcdh = crypto.createECDH('prime256v1');
    clientEcdh.generateKeys();
    const clientPub = clientEcdh.getPublicKey().toString('base64url');
    const authSecret = crypto.randomBytes(16).toString('base64url');

    const encrypted = encryptWebPushPayload(Buffer.from('{"title":"Hello"}', 'utf8'), clientPub, authSecret);
    // Header: 16B salt + 4B rs + 1B idlen(65) + 65B server pubkey = 86 bytes + ciphertext + 16B tag
    expect(encrypted.length).toBeGreaterThan(86 + 16);
    expect(encrypted.readUInt32BE(16)).toBe(4096);
    expect(encrypted.readUInt8(20)).toBe(65);
  });

  it('subscribes and unsubscribes a browser push endpoint', async () => {
    const keyRes = await ctx.http().get('/notifications/push/vapid-key').set(auth(owner.accessToken));
    expect(keyRes.status).toBe(200);
    expect(keyRes.body).toHaveProperty('enabled');

    const endpoint = 'https://push.example.com/sub/12345';
    const subRes = await ctx
      .http()
      .post('/notifications/push/subscribe')
      .set(auth(owner.accessToken))
      .send({
        endpoint,
        keys: {
          p256dh: crypto.randomBytes(65).toString('base64url'),
          auth: crypto.randomBytes(16).toString('base64url'),
        },
        userAgent: 'Vitest/1.0',
      });
    expect(subRes.status).toBe(200);
    expect(subRes.body.ok).toBe(true);

    const delRes = await ctx
      .http()
      .delete('/notifications/push/subscribe')
      .set(auth(owner.accessToken))
      .send({ endpoint });
    expect(delRes.status).toBe(204);
  });
});
