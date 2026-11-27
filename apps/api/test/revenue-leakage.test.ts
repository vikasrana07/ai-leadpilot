import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let agent: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'rlOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'rlAgent', 'agent');
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('Revenue Leakage Radar', () => {
  it('computes leaking hot leads, overdue promises, and voice-note admin savings with agent scoping', async () => {
    const createRes = await ctx.http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({
        name: 'Hot Uncontacted Buyer',
        phone: '+919840011223',
        budgetMax: 8500000,
      });
    expect(createRes.status).toBe(201);
    const leadId = createRes.body.id as string;

    const scoreRes = await ctx.http()
      .post(`/leads/${leadId}/score/override`)
      .set(auth(owner.accessToken))
      .send({ score: 90, temperature: 'HOT', reason: 'High-intent test lead' });
    expect(scoreRes.status).toBe(200);

    // Apply a voice note with a commitment -> increments voiceNotesApplied + promisesCaptured
    const applyRes = await ctx.http()
      .post(`/leads/${leadId}/voice-note/apply`)
      .set(auth(owner.accessToken))
      .send({
        note: "Spoke with buyer, I'll send the brochure in 30 mins",
        updates: {},
      });
    expect(applyRes.status).toBe(200);

    const radar = await ctx.http().get('/analytics/revenue-leakage?range=30d').set(auth(owner.accessToken));
    expect(radar.status).toBe(200);
    expect(radar.body.leaking.staleHotLeads).toBeGreaterThanOrEqual(1);
    expect(radar.body.leaking.staleHotBudgetMinor).toBeGreaterThanOrEqual(850000000);
    expect(radar.body.recovered.voiceNotesApplied).toBe(1);
    expect(radar.body.recovered.adminMinutesSaved).toBe(5);
    expect(radar.body.recovered.promisesCaptured).toBe(1);

    // Agent only sees their own assigned leads (unassigned hot lead is excluded from agent's radar)
    const agentRadar = await ctx.http().get('/analytics/revenue-leakage?range=30d').set(auth(agent.accessToken));
    expect(agentRadar.status).toBe(200);
    expect(agentRadar.body.leaking.staleHotLeads).toBe(0);
  });
});
