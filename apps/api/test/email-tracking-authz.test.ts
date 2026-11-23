import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailTrackingService } from '../src/email-tracking/email-tracking.service.js';
import { actorFrom } from '../src/common/actor.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-05: the email-tracking API returned tenant-wide data to members who only hold own-scoped lead permissions,
 * let them edit the tenant-wide suppression list, and let them email any lead (or any address) from the workspace's domain.
 * Rows are written with the OWNER role so the test controls exactly which lead each email belongs to.
 */
let ctx: TestCtx;
let owner$: pg.Pool;
let owner: Account; let manager: Account; let agent: Account;
let ownLeadId: string; let otherLeadId: string;
const ownEmailId = randomUUID(); const otherEmailId = randomUUID(); const suppressionId = randomUUID();

beforeAll(async () => {
  ctx = await createTestApp();
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'emailAuthzOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  manager = await addMember(ctx, owner, 'emailAuthzMgr', 'manager');
  agent = await addMember(ctx, owner, 'emailAuthzAgent', 'agent');
  const mine = await ctx.http().post('/leads').set(auth(agent.accessToken)).send({ name: 'Agent Lead', phone: '+919800000301', email: 'agent-lead@example.test' });
  const theirs = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Colleague Lead', phone: '+919800000302', email: 'colleague-lead@example.test' });
  expect(mine.status).toBe(201); expect(theirs.status).toBe(201);
  ownLeadId = mine.body.id; otherLeadId = theirs.body.id;
  const row = (id: string, leadId: string, to: string) => owner$.query(
    `INSERT INTO tracked_emails (id, tenant_id, lead_id, recipient, subject, status, updated_at) VALUES ($1, $2, $3, $4, 'Hello', 'SENT', now())`,
    [id, owner.tenantId, leadId, to],
  );
  await row(ownEmailId, ownLeadId, 'agent-lead@example.test');
  await row(otherEmailId, otherLeadId, 'colleague-lead@example.test');
  await owner$.query(`INSERT INTO email_suppressions (id, tenant_id, email, reason, source) VALUES ($1, $2, 'bounced@example.test', 'MANUAL', 'test')`, [suppressionId, owner.tenantId]);
});

afterAll(async () => {
  await owner$.query('DELETE FROM email_engagement_events WHERE tenant_id = $1', [owner.tenantId]);
  await owner$.query('DELETE FROM tracked_emails WHERE tenant_id = $1', [owner.tenantId]);
  await owner$.query('DELETE FROM email_suppressions WHERE tenant_id = $1', [owner.tenantId]);
  await owner$.end();
  await ctx.close();
  await cleanup();
});

const get = (t: Account, path: string) => ctx.http().get(path).set(auth(t.accessToken));

describe('email tracking: row-level scope', () => {
  it('an agent sees only emails about leads assigned to them (list, stats, detail)', async () => {
    const list = await get(agent, '/emails');
    expect(list.status).toBe(200);
    expect(list.body.items.map((e: { id: string }) => e.id)).toEqual([ownEmailId]);
    expect(list.body.total).toBe(1);
    expect((await get(agent, '/emails/stats')).body.totalSent).toBe(1);
    expect((await get(agent, `/emails/${ownEmailId}`)).status).toBe(200);
    expect((await get(agent, `/emails/${otherEmailId}`)).status).toBe(404); // existence is not revealed
  });

  it('managers and owners see every email in the workspace', async () => {
    for (const who of [manager, owner]) {
      const list = await get(who, '/emails');
      expect(list.body.items.map((e: { id: string }) => e.id).sort()).toEqual([ownEmailId, otherEmailId].sort());
      expect((await get(who, '/emails/stats')).body.totalSent).toBe(2);
      expect((await get(who, `/emails/${otherEmailId}`)).status).toBe(200);
    }
  });
});

describe('email tracking: suppression list', () => {
  it('an agent can neither read nor change the tenant-wide suppression list', async () => {
    expect((await get(agent, '/emails/suppressions')).status).toBe(403);
    expect((await ctx.http().post('/emails/suppressions').set(auth(agent.accessToken)).send({ email: 'x@example.test', reason: 'MANUAL' })).status).toBe(403);
    expect((await ctx.http().delete(`/emails/suppressions/${suppressionId}`).set(auth(agent.accessToken))).status).toBe(403);
    const { rows } = await owner$.query('SELECT 1 FROM email_suppressions WHERE id = $1', [suppressionId]);
    expect(rows.length).toBe(1); // still there
  });

  it('a manager can read the list', async () => {
    const res = await get(manager, '/emails/suppressions');
    expect(res.status).toBe(200);
    expect(res.body.items.some((s: { email: string }) => s.email === 'bounced@example.test')).toBe(true);
  });
});

describe('email tracking: who may send', () => {
  it('an agent cannot email someone else\'s lead (404, not revealed) or an arbitrary address with no lead (403)', async () => {
    const send = (body: object) => ctx.http().post('/emails/send').set(auth(agent.accessToken)).send({ subject: 'Hi', text: 'Hello', ...body });
    expect((await send({ to: 'colleague-lead@example.test', leadId: otherLeadId })).status).toBe(404);
    expect((await send({ to: 'anyone@example.test' })).status).toBe(403);
    expect((await send({ to: 'anyone@example.test', leadId: randomUUID() })).status).toBe(404);
  });

  it('permits an agent to email their own lead and a manager to email any lead', async () => {
    const service = ctx.app.get(EmailTrackingService);
    const actor = (a: Account, perms: string[], membershipId: string | null) => ({ ...actorFrom({ tenantId: a.tenantId, userId: a.userId, membershipId: membershipId ?? '', permissions: new Set(perms), requestId: undefined, ip: undefined } as never) });
    const agentMembership = (await owner$.query('SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [agent.tenantId, agent.userId])).rows[0].id as string;
    await expect(service.assertCanEmail(actor(agent, ['lead:write:own'], agentMembership), ownLeadId)).resolves.toBeUndefined();
    await expect(service.assertCanEmail(actor(manager, ['lead:write:all'], null), otherLeadId)).resolves.toBeUndefined();
    await expect(service.assertCanEmail(actor(manager, ['lead:write:all'], null))).resolves.toBeUndefined();
  });
});
