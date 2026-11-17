import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/** GET /automations/runs/:id: one run with its recorded steps, so the canvas can draw the path a past run took. Read-only, same guards as the rest. */
let ctx: TestCtx; let owner: Account; let stranger: Account; let agent: Account;
beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'runDetailOwner'); stranger = await registerAccount(ctx, 'runDetailOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'runDetailAgent', 'agent');
});
afterAll(async () => { await ctx.close(); await cleanup(); });

describe('GET /automations/runs/:id', () => {
  it('returns the run with its steps (including node ids), and nobody else can read it', async () => {
    const lead = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Run Detail Lead', phone: '+919811100777' })).body.id as string;
    const graph = { v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'lead.created' } }, { id: 'b', type: 'branch', data: { match: 'all', conditions: [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }] } }, { id: 'a', type: 'action', data: { type: 'add_tag', tag: 'seen' } }],
      edges: [{ id: 'e1', from: 't', to: 'b', label: 'next' }, { id: 'e2', from: 'b', to: 'a', label: 'yes' }] };
    const created = await ctx.http().post('/automations').set(auth(owner.accessToken)).send({ name: 'Run detail', cooldownMinutes: 0, graph });
    expect(created.status).toBe(201);
    const dry = await ctx.http().post(`/automations/${created.body.id}/dry-run`).set(auth(owner.accessToken)).send({ leadId: lead });
    expect(dry.status).toBe(200);
    const one = await ctx.http().get(`/automations/runs/${dry.body.runId}`).set(auth(owner.accessToken));
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: dry.body.runId, automationId: created.body.id, automationName: 'Run detail', status: 'DRY_RUN', leadName: 'Run Detail Lead' });
    const steps = one.body.steps as { nodeId?: string; type: string; branch?: string }[];
    expect(steps.some((s) => s.nodeId === 'b' && s.type === 'branch' && (s.branch === 'yes' || s.branch === 'no'))).toBe(true);

    expect((await ctx.http().get(`/automations/runs/${dry.body.runId}`).set(auth(stranger.accessToken))).status).toBe(404);              // another workspace
    expect((await ctx.http().get(`/automations/runs/${dry.body.runId}`).set(auth(agent.accessToken))).status).toBe(403);                  // no automation:manage
    expect((await ctx.http().get(`/automations/runs/${dry.body.runId}`)).status).toBe(401);                                                // no credentials
    expect((await ctx.http().get('/automations/runs/not-a-uuid').set(auth(owner.accessToken))).status).toBe(400);
    expect((await ctx.http().get('/automations/runs/00000000-0000-0000-0000-000000000000').set(auth(owner.accessToken))).status).toBe(404);
  });
});
