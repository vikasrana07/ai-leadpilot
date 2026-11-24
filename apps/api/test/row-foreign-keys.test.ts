import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-09 (phase 2): references between rows are enforced by composite (tenant_id, id) foreign keys, so a row can neither dangle
 * nor point at another workspace's parent, and the delete behaviour is the one chosen per column.
 * Fixtures are written with the OWNER role (which bypasses RLS) to prove the constraint itself, not the policy.
 */
let ctx: TestCtx; let db: pg.Pool; let a: Account; let b: Account;
let leadA: string; let membershipA: string; let membershipB: string;

const insertTask = (tenantId: string, leadId: string | null, assignee: string | null) =>
  db.query(`INSERT INTO tasks (id, tenant_id, lead_id, assignee_membership_id, title) VALUES ($1, $2, $3, $4, 'T') RETURNING id`, [randomUUID(), tenantId, leadId, assignee]);

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  a = await registerAccount(ctx, 'rowFkA'); b = await registerAccount(ctx, 'rowFkB');
  leadA = (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'FK Lead', phone: '+919800000805' })).body.id;
  membershipA = (await db.query('SELECT id FROM memberships WHERE tenant_id = $1 LIMIT 1', [a.tenantId])).rows[0].id;
  membershipB = (await db.query('SELECT id FROM memberships WHERE tenant_id = $1 LIMIT 1', [b.tenantId])).rows[0].id;
});
afterAll(async () => {
  await db.query('DELETE FROM tasks WHERE tenant_id = ANY($1)', [[a.tenantId, b.tenantId]]);
  await db.end(); await ctx.close(); await cleanup();
});

describe('row foreign keys', () => {
  it('refuse a reference to a row that does not exist', async () => {
    await expect(insertTask(a.tenantId, randomUUID(), null)).rejects.toThrow(/tasks_lead_id_fkey/);
  });

  it('refuse a reference to ANOTHER workspace\'s row, even though the id exists', async () => {
    await expect(insertTask(b.tenantId, leadA, null)).rejects.toThrow(/tasks_lead_id_fkey/); // B's task, A's lead
    await expect(insertTask(a.tenantId, null, membershipB)).rejects.toThrow(/tasks_assignee_membership_id_fkey/); // A's task, B's member
  });

  it('SET NULL clears only the reference: the child keeps its workspace', async () => {
    const target = (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'FK Target', phone: '+919800000801' })).body.id;
    const merged = (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'FK Merged', phone: '+919800000802' })).body.id;
    await db.query('UPDATE leads SET merged_into_id = $1 WHERE id = $2', [target, merged]);
    await db.query('DELETE FROM leads WHERE id = $1', [target]);
    const row = (await db.query('SELECT tenant_id, merged_into_id FROM leads WHERE id = $1', [merged])).rows[0];
    expect(row).toEqual({ tenant_id: a.tenantId, merged_into_id: null });
  });

  it('CASCADE removes data a lead owns when the lead is deleted', async () => {
    const lead = (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'FK Owner', phone: '+919800000803' })).body.id;
    const task = (await insertTask(a.tenantId, lead, null)).rows[0].id;
    await db.query('DELETE FROM leads WHERE id = $1', [lead]);
    expect((await db.query('SELECT 1 FROM tasks WHERE id = $1', [task])).rowCount).toBe(0);
  });

  it('RESTRICT keeps history: a member with appointments cannot be deleted', async () => {
    const lead = (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'FK Visit', phone: '+919800000804' })).body.id;
    await db.query(`INSERT INTO appointments (id, tenant_id, lead_id, membership_id, title, starts_at, ends_at, updated_at) VALUES ($1, $2, $3, $4, 'V', '2027-01-05T10:00:00Z', '2027-01-05T11:00:00Z', now())`, [randomUUID(), a.tenantId, lead, membershipA]);
    await expect(db.query('DELETE FROM memberships WHERE id = $1', [membershipA])).rejects.toThrow(/appointments_membership_id_fkey/);
    await db.query('DELETE FROM appointments WHERE tenant_id = $1', [a.tenantId]);
  });
});
