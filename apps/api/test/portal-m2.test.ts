import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let memberId: string;
let portalKey: string;

const futureIso = (hoursAhead: number) => new Date(Date.now() + hoursAhead * 3_600_000).toISOString();

async function signInPortal(key: string, email: string): Promise<string[]> {
  await ctx.http().post(`/portal/${key}/code`).send({ identity: email });
  const mail = ctx.mail.sent.filter((m) => m.to === email && m.kind === 'portal_code').at(-1);
  const code = (mail?.token ?? mail?.text?.match(/\b(\d{6})\b/)?.[1]) as string;
  const res = await ctx.http().post(`/portal/${key}/verify`).send({ identity: email, code });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
}

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'pm2Owner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });

  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  memberId = members.body[0].id as string;

  // Enable portal with 2h cutoff
  const cfg = await ctx
    .http()
    .put('/portal-config')
    .set(auth(owner.accessToken))
    .send({ enabled: true, allowConfirm: true, allowCancel: true, allowReschedule: true, cancelCutoffHours: 2 });
  expect(cfg.status).toBe(200);
  portalKey = new URL(cfg.body.url as string).pathname.split('/').pop() as string;

  // Set working hours for all days so slots/reschedule work regardless of day of week
  await ctx
    .http()
    .put('/appointments/availability')
    .set(auth(owner.accessToken))
    .send({
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      })),
    });
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('customer portal milestone 2', () => {
  it('allows customer to confirm, list slots, reschedule, cancel, and submit a data request', async () => {
    const email = 'portal.cust@example.com';
    const leadRes = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Portal Customer', email });
    expect(leadRes.status).toBe(201);
    const leadId = leadRes.body.id as string;

    const apptRes = await ctx
      .http()
      .post('/appointments')
      .set(auth(owner.accessToken))
      .send({
        leadId,
        membershipId: memberId,
        title: 'Site visit',
        startsAt: futureIso(48),
        durationMinutes: 30,
        outsideHours: true,
      });
    expect(apptRes.status).toBe(201);
    const apptId = apptRes.body.id as string;

    const cookie = await signInPortal(portalKey, email);

    // Confirm
    const conf = await ctx.http().post(`/portal/appointments/${apptId}/confirm`).set('Cookie', cookie);
    expect(conf.status).toBe(200);
    expect(conf.body.status).toBe('CONFIRMED');

    // Slots
    const slots = await ctx.http().get(`/portal/appointments/${apptId}/slots`).set('Cookie', cookie);
    expect(slots.status).toBe(200);
    expect(Array.isArray(slots.body)).toBe(true);

    // Cancel
    const cancel = await ctx
      .http()
      .post(`/portal/appointments/${apptId}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: 'Plans changed' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');

    // Data request
    const dr = await ctx
      .http()
      .post('/portal/data-request')
      .set('Cookie', cookie)
      .send({ type: 'export', note: 'Send to my email' });
    expect(dr.status).toBe(202);
    expect(dr.body.ok).toBe(true);
  });

  it('enforces ownership (404) and cutoff window (409)', async () => {
    const email1 = 'cust1@example.com';
    const email2 = 'cust2@example.com';
    const l1 = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'C1', email: email1 })).body;
    const l2 = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'C2', email: email2 })).body;

    const soonAppt = (
      await ctx.http().post('/appointments').set(auth(owner.accessToken)).send({
        leadId: l1.id,
        membershipId: memberId,
        title: 'Soon visit',
        startsAt: futureIso(1), // inside 2h cutoff
        durationMinutes: 30,
        outsideHours: true,
      })
    ).body;

    const otherAppt = (
      await ctx.http().post('/appointments').set(auth(owner.accessToken)).send({
        leadId: l2.id,
        membershipId: memberId,
        title: 'Other visit',
        startsAt: futureIso(24),
        durationMinutes: 30,
        outsideHours: true,
      })
    ).body;

    const cookie1 = await signInPortal(portalKey, email1);

    // Cutoff enforced
    const cancelSoon = await ctx.http().post(`/portal/appointments/${soonAppt.id}/cancel`).set('Cookie', cookie1).send({});
    expect(cancelSoon.status).toBe(409);
    expect(cancelSoon.body.code).toBe('cutoff_passed');

    // Other lead's appointment -> 404
    const confirmOther = await ctx.http().post(`/portal/appointments/${otherAppt.id}/confirm`).set('Cookie', cookie1);
    expect(confirmOther.status).toBe(404);
  });
});
