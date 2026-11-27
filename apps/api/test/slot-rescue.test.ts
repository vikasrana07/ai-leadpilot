import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let memberId: string;

const futureIso = (hoursAhead: number) => new Date(Date.now() + hoursAhead * 3_600_000).toISOString();

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'srOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  memberId = members.body[0].id as string;
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('self-healing calendar (slot rescue)', () => {
  it('offers a cancelled slot to top HOT/WARM leads and lets only the first claimant book it', async () => {
    // Enable Slot Rescue
    const cfg = await ctx
      .http()
      .put('/appointments/slot-rescue/settings')
      .set(auth(owner.accessToken))
      .send({ enabled: true, maxCandidates: 5, minTemperature: 'WARM' });
    expect(cfg.status).toBe(200);
    expect(cfg.body.enabled).toBe(true);

    // Create original lead + 2 HOT candidates
    const origLead = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Cancelling Guest', email: 'cancel@example.com' })).body;
    const cand1 = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Hot Candidate 1', email: 'hot1@example.com' })).body;
    const cand2 = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Hot Candidate 2', email: 'hot2@example.com' })).body;
    await ctx.http().post(`/leads/${cand1.id}/score/override`).set(auth(owner.accessToken)).send({ score: 90, temperature: 'HOT', reason: 'Test' });
    await ctx.http().post(`/leads/${cand2.id}/score/override`).set(auth(owner.accessToken)).send({ score: 85, temperature: 'HOT', reason: 'Test' });

    // Book an appointment 24h from now and cancel it
    const appt = (
      await ctx.http().post('/appointments').set(auth(owner.accessToken)).send({
        leadId: origLead.id,
        membershipId: memberId,
        title: 'Site visit',
        startsAt: futureIso(24),
        durationMinutes: 30,
        outsideHours: true,
      })
    ).body;

    const cancel = await ctx
      .http()
      .post(`/appointments/${appt.id}/cancel`)
      .set(auth(owner.accessToken))
      .send({ reason: 'Cannot make it' });
    expect(cancel.status).toBe(200);

    // Wait briefly for async SlotRescue offer creation
    let offers: { id: string; claimToken: string; offeredLeadIds: string[]; status: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await ctx.http().get('/appointments/slot-rescue').set(auth(owner.accessToken));
      if (res.body.length > 0) {
        offers = res.body;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(offers.length).toBe(1);
    const offer = offers[0]!;
    expect(offer.status).toBe('OPEN');
    expect(offer.offeredLeadIds).toContain(cand1.id);
    expect(offer.offeredLeadIds).toContain(cand2.id);

    // Public GET returns offer details
    const pub = await ctx.http().get(`/portal/claim/${offer.claimToken}`);
    expect(pub.status).toBe(200);
    expect(pub.body.expired).toBe(false);

    // First candidate claims the slot -> 200
    const claim1 = await ctx.http().post(`/portal/claim/${offer.claimToken}`).send({ leadId: cand1.id });
    expect(claim1.status).toBe(200);
    expect(claim1.body.ok).toBe(true);
    expect(claim1.body.appointmentId).toBeTruthy();

    // Second candidate tries to claim -> 409 Conflict
    const claim2 = await ctx.http().post(`/portal/claim/${offer.claimToken}`).send({ leadId: cand2.id });
    expect(claim2.status).toBe(409);
    expect(claim2.body.error?.code ?? claim2.body.code).toBe('slot_already_claimed');
  });
});
