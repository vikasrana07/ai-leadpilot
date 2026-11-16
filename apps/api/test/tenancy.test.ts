import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenService } from '../src/auth/token.service.js';
import { addMember, auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let ownerA: Account;
let ownerB: Account;
let managerA: Account;
let agentA: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  ownerA = await registerAccount(ctx, 'ownerA');
  ownerB = await registerAccount(ctx, 'ownerB');
  // team invites require a verified email
  const t = ctx.mail.last('verify', ownerA.email)?.token as string;
  const v = await ctx.http().post('/auth/verify-email').send({ token: t });
  if (v.status !== 204) throw new Error('verify failed ' + v.status + JSON.stringify(v.body) + ' token=' + String(t));
  managerA = await addMember(ctx, ownerA, 'managerA', 'manager');
  agentA = await addMember(ctx, ownerA, 'agentA', 'agent');
});
afterAll(async () => { await ctx.close(); await cleanup(); });

describe('cross-tenant isolation (API level)', () => {
  it('tenant data endpoints only ever return the caller\'s tenant', async () => {
    const a = await ctx.http().get('/tenant').set(auth(ownerA.accessToken));
    const b = await ctx.http().get('/tenant').set(auth(ownerB.accessToken));
    expect(a.body.id).toBe(ownerA.tenantId);
    expect(b.body.id).toBe(ownerB.tenantId);
    const membersA = await ctx.http().get('/team/members').set(auth(ownerA.accessToken));
    expect(membersA.body.map((m: { user: { email: string } }) => m.user.email).sort()).toEqual([ownerA.email, managerA.email, agentA.email].sort());
    const membersB = await ctx.http().get('/team/members').set(auth(ownerB.accessToken));
    expect(membersB.body).toHaveLength(1);
  });

  it('a client-supplied tenant id (query, header, body) never changes the tenant context', async () => {
    const res = await ctx.http().get(`/tenant?tenantId=${ownerB.tenantId}`).set(auth(ownerA.accessToken)).set('X-Tenant-Id', ownerB.tenantId).set('X-Workspace', ownerB.tenantId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ownerA.tenantId);
    const patch = await ctx.http().patch('/tenant').set(auth(ownerA.accessToken)).send({ id: ownerB.tenantId, tenantId: ownerB.tenantId, name: 'Renamed A' });
    expect(patch.status).toBe(200);
    expect(patch.body.id).toBe(ownerA.tenantId);
    const b = await ctx.http().get('/tenant').set(auth(ownerB.accessToken));
    expect(b.body.name).not.toBe('Renamed A');
  });

  it('cannot switch into a workspace without membership', async () => {
    const res = await ctx.http().post('/auth/switch-workspace').set(auth(ownerA.accessToken)).send({ tenantId: ownerB.tenantId });
    expect(res.status).toBe(403);
  });

  it('a validly signed token claiming a foreign tenant is rejected by the membership check', async () => {
    const tokens = ctx.app.get(TokenService);
    const me = await ctx.http().get('/auth/me').set(auth(ownerA.accessToken));
    // find A's real session id by decoding via a fresh session list
    const sessions = await ctx.http().get('/auth/sessions').set(auth(ownerA.accessToken));
    const current = sessions.body.find((s: { current: boolean }) => s.current);
    const forged = await tokens.signAccess({ userId: me.body.user.id, sessionId: current.id, tenantId: ownerB.tenantId });
    const res = await ctx.http().get('/tenant').set(auth(forged));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('workspace_access_denied');
  });

  it('audit logs never include another tenant\'s events', async () => {
    const res = await ctx.http().get('/audit-logs?limit=100').set(auth(ownerB.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((e: { tenantId: string }) => e.tenantId === ownerB.tenantId)).toBe(true);
  });
});

describe('RBAC and privilege escalation', () => {
  it('agents cannot read audit logs, invite, change roles or edit settings', async () => {
    expect((await ctx.http().get('/audit-logs').set(auth(agentA.accessToken))).status).toBe(403);
    expect((await ctx.http().post('/team/invitations').set(auth(agentA.accessToken)).send({ email: `x-${RUN}@example.test`, roleKey: 'agent' })).status).toBe(403);
    expect((await ctx.http().patch('/tenant').set(auth(agentA.accessToken)).send({ name: 'Nope Nope' })).status).toBe(403);
    const members = await ctx.http().get('/team/members').set(auth(ownerA.accessToken));
    const mgr = members.body.find((m: { user: { email: string } }) => m.user.email === managerA.email);
    expect((await ctx.http().patch(`/team/members/${mgr.id}/role`).set(auth(agentA.accessToken)).send({ roleKey: 'agent' })).status).toBe(403);
  });

  it('managers cannot grant or take the owner role, nor demote/deactivate an owner', async () => {
    const members = await ctx.http().get('/team/members').set(auth(managerA.accessToken));
    const agent = members.body.find((m: { user: { email: string } }) => m.user.email === agentA.email);
    const owner = members.body.find((m: { user: { email: string } }) => m.user.email === ownerA.email);
    // manager lacks team:manage by default -> 403 either way; use the owner path for finer rules below
    expect((await ctx.http().patch(`/team/members/${agent.id}/role`).set(auth(managerA.accessToken)).send({ roleKey: 'owner' })).status).toBe(403);
    expect((await ctx.http().patch(`/team/members/${owner.id}/status`).set(auth(managerA.accessToken)).send({ status: 'DEACTIVATED' })).status).toBe(403);
    // inviting an owner is also blocked for a manager
    expect((await ctx.http().post('/team/invitations').set(auth(managerA.accessToken)).send({ email: `own-${RUN}@example.test`, roleKey: 'owner' })).status).toBe(403);
  });

  it('prevents removing or demoting the last owner, and self role changes', async () => {
    const members = await ctx.http().get('/team/members').set(auth(ownerA.accessToken));
    const self = members.body.find((m: { user: { email: string } }) => m.user.email === ownerA.email);
    const selfChange = await ctx.http().patch(`/team/members/${self.id}/role`).set(auth(ownerA.accessToken)).send({ roleKey: 'agent' });
    expect(selfChange.status).toBe(400);
    const selfDeactivate = await ctx.http().patch(`/team/members/${self.id}/status`).set(auth(ownerA.accessToken)).send({ status: 'DEACTIVATED' });
    expect(selfDeactivate.status).toBe(400);
  });

  it('cannot manage a member of another tenant by guessing their membership id', async () => {
    const membersB = await ctx.http().get('/team/members').set(auth(ownerB.accessToken));
    const victim = membersB.body[0];
    const res = await ctx.http().patch(`/team/members/${victim.id}/status`).set(auth(ownerA.accessToken)).send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(404);
    const still = await ctx.http().get('/team/members').set(auth(ownerB.accessToken));
    expect(still.body[0].status).toBe('ACTIVE');
  });

  it('deactivating a member cuts off their access immediately; reactivating restores it', async () => {
    const members = await ctx.http().get('/team/members').set(auth(ownerA.accessToken));
    const agent = members.body.find((m: { user: { email: string } }) => m.user.email === agentA.email);
    expect((await ctx.http().get('/tenant').set(auth(agentA.accessToken))).status).toBe(200);
    expect((await ctx.http().patch(`/team/members/${agent.id}/status`).set(auth(ownerA.accessToken)).send({ status: 'DEACTIVATED' })).status).toBe(200);
    expect((await ctx.http().get('/tenant').set(auth(agentA.accessToken))).status).toBe(403);
    expect((await ctx.http().patch(`/team/members/${agent.id}/status`).set(auth(ownerA.accessToken)).send({ status: 'ACTIVE' })).status).toBe(200);
    expect((await ctx.http().get('/tenant').set(auth(agentA.accessToken))).status).toBe(200);
  });

  it('owners can change roles and the change is audited', async () => {
    const members = await ctx.http().get('/team/members').set(auth(ownerA.accessToken));
    const agent = members.body.find((m: { user: { email: string } }) => m.user.email === agentA.email);
    expect((await ctx.http().patch(`/team/members/${agent.id}/role`).set(auth(ownerA.accessToken)).send({ roleKey: 'manager' })).status).toBe(200);
    const log = await ctx.http().get('/audit-logs?action=team.role_changed').set(auth(ownerA.accessToken));
    expect(log.body.items[0].metadata).toMatchObject({ from: 'agent', to: 'manager' });
    await ctx.http().patch(`/team/members/${agent.id}/role`).set(auth(ownerA.accessToken)).send({ roleKey: 'agent' });
  });
});

describe('invitations', () => {
  it('requires a verified inviter', async () => {
    const res = await ctx.http().post('/team/invitations').set(auth(ownerB.accessToken)).send({ email: `v-${RUN}@example.test`, roleKey: 'agent' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_unverified');
  });

  it('tokens are single-use, revocable, and previewable only with the secret', async () => {
    const email = `it-${RUN}-inv1@example.test`;
    await ctx.http().post('/team/invitations').set(auth(ownerA.accessToken)).send({ email, roleKey: 'agent' });
    const token = ctx.mail.last('invite', email)?.token as string;
    const preview = await ctx.http().post('/auth/invitations/preview').send({ token });
    expect(preview.body).toMatchObject({ email, role: 'Sales Agent', hasAccount: false });
    expect((await ctx.http().post('/auth/invitations/accept').send({ token: 'x'.repeat(43) })).status).toBe(400);
    // missing account details
    expect((await ctx.http().post('/auth/invitations/accept').send({ token })).status).toBe(400);
    const ok = await ctx.http().post('/auth/invitations/accept').send({ token, name: 'Inv One', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.workspaces[0].roleKey).toBe('agent');
    expect((await ctx.http().post('/auth/invitations/accept').send({ token, name: 'Inv One', password: PASSWORD })).status).toBe(400);

    const email2 = `it-${RUN}-inv2@example.test`;
    const created = await ctx.http().post('/team/invitations').set(auth(ownerA.accessToken)).send({ email: email2, roleKey: 'agent' });
    const t2 = ctx.mail.last('invite', email2)?.token as string;
    expect((await ctx.http().delete(`/team/invitations/${created.body.id}`).set(auth(ownerA.accessToken))).status).toBe(204);
    expect((await ctx.http().post('/auth/invitations/accept').send({ token: t2, name: 'Inv Two', password: PASSWORD })).status).toBe(400);
  });

  it('an existing account must be signed in as the invitee to accept, and ends up with both workspaces', async () => {
    const existing = await registerAccount(ctx, 'multi');
    await ctx.http().post('/team/invitations').set(auth(ownerA.accessToken)).send({ email: existing.email, roleKey: 'agent' });
    const token = ctx.mail.last('invite', existing.email)?.token as string;
    // anonymous, or signed in as somebody else, must fail
    expect((await ctx.http().post('/auth/invitations/accept').send({ token })).status).toBe(401);
    expect((await ctx.http().post('/auth/invitations/accept').set(auth(ownerB.accessToken)).send({ token })).status).toBe(401);
    const ok = await ctx.http().post('/auth/invitations/accept').set(auth(existing.accessToken)).send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.workspaces).toHaveLength(2);
  });
});

describe('workspace switching', () => {
  it('lets a multi-workspace user switch and applies that workspace\'s role', async () => {
    const login = await ctx.http().post('/auth/login').set('x-token-delivery', 'body').send({ email: `it-${RUN}-multi@example.test`, password: PASSWORD });
    expect(login.body.workspaces).toHaveLength(2);
    const agentWs = login.body.workspaces.find((w: { roleKey: string }) => w.roleKey === 'agent');
    const switched = await ctx.http().post('/auth/switch-workspace').set(auth(login.body.accessToken)).set('x-token-delivery', 'body').send({ tenantId: agentWs.tenantId });
    expect(switched.status).toBe(200);
    expect(switched.body.activeTenantId).toBe(agentWs.tenantId);
    expect((await ctx.http().get('/audit-logs').set(auth(switched.body.accessToken))).status).toBe(403);
  });
});

describe('onboarding progress', () => {
  it('persists resumable progress and validates the payload', async () => {
    const bad = await ctx.http().put('/tenant/onboarding').set(auth(ownerA.accessToken)).send({ step: 'bogus', completed: [] });
    expect(bad.status).toBe(400);
    const ok = await ctx.http().put('/tenant/onboarding').set(auth(ownerA.accessToken)).send({ step: 'team', completed: ['business', 'industry'] });
    expect(ok.status).toBe(200);
    const got = await ctx.http().get('/tenant/onboarding').set(auth(ownerA.accessToken));
    expect(got.body).toMatchObject({ step: 'team', completed: ['business', 'industry'] });
  });
});
