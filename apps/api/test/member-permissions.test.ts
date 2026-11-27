import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let agent: Account;
let agentMembershipId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'permOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'permAgent', 'agent');
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  agentMembershipId = members.body.find((m: { user: { email: string } }) => m.user.email === agent.email).id;
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('member permission overrides', () => {
  it('grants an extra permission and revokes a role permission on a member', async () => {
    // Agent normally cannot export leads
    expect((await ctx.http().get('/leads/export').set(auth(agent.accessToken))).status).toBe(403);

    // Grant lead:export and revoke appointment:write
    const put = await ctx
      .http()
      .put(`/team/members/${agentMembershipId}/permissions`)
      .set(auth(owner.accessToken))
      .send({
        overrides: [
          { permissionKey: 'lead:export', effect: 'GRANT' },
          { permissionKey: 'appointment:write', effect: 'REVOKE' },
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.effectivePermissions).toContain('lead:export');
    expect(put.body.effectivePermissions).not.toContain('appointment:write');

    // Auth /me reflects effective permissions
    const me = await ctx.http().get('/auth/me').set(auth(agent.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain('lead:export');
    expect(me.body.permissions).not.toContain('appointment:write');

    // Now agent can access /leads/export (or gets plan-gated / 200, not 403 forbidden)
    const exp = await ctx.http().get('/leads/export').set(auth(agent.accessToken));
    expect(exp.status).not.toBe(403);

    // Clear overrides
    const clear = await ctx
      .http()
      .put(`/team/members/${agentMembershipId}/permissions`)
      .set(auth(owner.accessToken))
      .send({ overrides: [] });
    expect(clear.status).toBe(200);
    expect(clear.body.effectivePermissions).not.toContain('lead:export');
    expect(clear.body.effectivePermissions).toContain('appointment:write');
  });

  it('rejects privilege escalation and unknown keys', async () => {
    const badKey = await ctx
      .http()
      .put(`/team/members/${agentMembershipId}/permissions`)
      .set(auth(owner.accessToken))
      .send({ overrides: [{ permissionKey: 'fake:perm', effect: 'GRANT' }] });
    expect(badKey.status).toBe(400);

    const agentTry = await ctx
      .http()
      .put(`/team/members/${agentMembershipId}/permissions`)
      .set(auth(agent.accessToken))
      .send({ overrides: [{ permissionKey: 'billing:manage', effect: 'GRANT' }] });
    expect(agentTry.status).toBe(403);
  });
});
