import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePortalEmail } from '../src/capture/portal-email/parsers.js';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'peOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('portal email parsing', () => {
  it('parses 99acres and Magicbricks alert emails', () => {
    const p1 = parsePortalEmail({
      sender: 'alerts@99acres.com',
      subject: 'New response on 99acres for 3BHK Wakad',
      text: 'Name: Rohan Kulkarni\nMobile: +91 98765 11223\nEmail: rohan@example.com\nLocation: Wakad, Pune\nBudget: 85 L',
    });
    expect(p1).toMatchObject({
      portal: '99acres',
      name: 'Rohan Kulkarni',
      phone: '+919876511223',
      email: 'rohan@example.com',
      location: 'Wakad, Pune',
    });

    const p2 = parsePortalEmail({
      sender: 'leads@magicbricks.com',
      subject: 'Magicbricks Lead Alert',
      html: '<p>Lead Name: Priya Nair</p><p>Phone: 9811122233</p><p>Locality: Whitefield</p>',
    });
    expect(p2).toMatchObject({
      portal: 'magicbricks',
      name: 'Priya Nair',
      phone: '9811122233',
      location: 'Whitefield',
    });
  });

  it('ingests a portal email webhook and creates a lead', async () => {
    const cfg = await ctx
      .http()
      .put('/integrations/portal-email')
      .set(auth(owner.accessToken))
      .send({ enabled: true });
    expect(cfg.status).toBe(200);
    const path = cfg.body.endpointPath as string;

    const hook = await ctx
      .http()
      .post(path)
      .send({
        from: 'alerts@99acres.com',
        subject: '99acres Buyer Enquiry',
        text: 'Name: Amit Shah\nPhone: +91 98200 12345\nLocation: Baner',
      });
    expect(hook.status).toBe(200);
    expect(hook.body).toMatchObject({ ok: true, status: 'imported', portal: '99acres' });

    const logs = await ctx.http().get('/integrations/portal-email/logs').set(auth(owner.accessToken));
    expect(logs.status).toBe(200);
    expect(logs.body.length).toBeGreaterThanOrEqual(1);

    // Invalid key -> 404
    const bad = await ctx.http().post('/webhooks/portal-email/pe_invalid_key').send({ text: 'Phone: 9820012345' });
    expect(bad.status).toBe(404);
  });
});
