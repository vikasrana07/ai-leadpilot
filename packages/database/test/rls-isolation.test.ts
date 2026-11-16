import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, withTenant, type PrismaClient } from '../src/index.js';

const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!appUrl || !ownerUrl) throw new Error('DATABASE_URL and DATABASE_OWNER_URL must be set');

let prisma: PrismaClient;
let owner: pg.Pool;

const A = randomUUID();
const B = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const roleA = randomUUID();
const roleB = randomUUID();

async function seedTenant(tenantId: string, userId: string, roleId: string, label: string): Promise<void> {
  await withTenant(prisma, { tenantId, userId }, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name: `Tenant ${label}`, email: `${label}@t.test`, industry: 'real_estate' } });
    await tx.role.create({ data: { id: roleId, tenantId, key: 'owner', name: 'Owner' } });
  });
  await withTenant(prisma, { tenantId: null, userId }, async (tx) => {
    await tx.user.create({ data: { id: userId, email: `${label}-${userId}@t.test`, passwordHash: 'x', name: label } });
  });
  await withTenant(prisma, { tenantId, userId }, async (tx) => {
    await tx.membership.create({ data: { tenantId, userId, roleId } });
    await tx.invitation.create({
      data: { tenantId, email: `inv-${label}@t.test`, roleId, tokenHash: `hash-${tenantId}`, invitedBy: userId, expiresAt: new Date(Date.now() + 1e6) },
    });
    await tx.auditLog.create({ data: { tenantId, actorUserId: userId, action: 'test.seed' } });
  });
}

beforeAll(async () => {
  prisma = createPrismaClient(appUrl);
  owner = new pg.Pool({ connectionString: ownerUrl });
  await seedTenant(A, userA, roleA, 'a');
  await seedTenant(B, userB, roleB, 'b');
});

afterAll(async () => {
  await owner.query('DELETE FROM invitations WHERE tenant_id = ANY($1)', [[A, B]]);
  await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [[A, B]]);
  await owner.query('DELETE FROM users WHERE id = ANY($1)', [[userA, userB]]);
  await owner.query('DELETE FROM audit_logs WHERE tenant_id = ANY($1)', [[A, B]]);
  await owner.end();
  await prisma.$disconnect();
});

describe('runtime DB role', () => {
  it('is not superuser, not BYPASSRLS, and owns nothing', async () => {
    const r = await owner.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'leadpilot_app'`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await owner.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner='leadpilot_app'`);
    expect(owned.rows[0].n).toBe(0);
  });
});

describe('RLS coverage (CI guard)', () => {
  it('every table with a tenant_id column has RLS enabled and at least one policy', async () => {
    const cols = await owner.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'`,
    );
    const tables = cols.rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(0);
    // `tenants` is scoped by its own `id`; include it explicitly.
    for (const t of [...tables, 'tenants']) {
      const rls = await owner.query(`SELECT relrowsecurity FROM pg_class WHERE relname=$1 AND relnamespace='public'::regnamespace`, [t]);
      expect(rls.rows[0]?.relrowsecurity, `RLS disabled on ${t}`).toBe(true);
      const pol = await owner.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t]);
      expect(pol.rows[0].n, `no policy on ${t}`).toBeGreaterThan(0);
    }
  });
});

describe('tenant isolation', () => {
  it('sees only its own rows on every tenant table', async () => {
    await withTenant(prisma, { tenantId: A, userId: userA }, async (tx) => {
      expect((await tx.role.findMany()).map((r) => r.id).sort()).toEqual([roleA]);
      expect((await tx.invitation.findMany()).every((i) => i.tenantId === A)).toBe(true);
      expect((await tx.auditLog.findMany()).every((l) => l.tenantId === A)).toBe(true);
      expect((await tx.tenant.findMany()).map((t) => t.id)).toEqual([A]);
    });
  });

  it('sees nothing without tenant context', async () => {
    await withTenant(prisma, { tenantId: null }, async (tx) => {
      expect(await tx.role.count()).toBe(0);
      expect(await tx.invitation.count()).toBe(0);
      expect(await tx.auditLog.count()).toBe(0);
      expect(await tx.tenant.count()).toBe(0);
      expect(await tx.membership.count()).toBe(0);
    });
  });

  it('cannot read another tenant row even when querying by its exact id', async () => {
    await withTenant(prisma, { tenantId: A, userId: userA }, async (tx) => {
      expect(await tx.tenant.findUnique({ where: { id: B } })).toBeNull();
      expect(await tx.role.findUnique({ where: { id: roleB } })).toBeNull();
    });
  });

  it('cannot insert rows for another tenant', async () => {
    await expect(
      withTenant(prisma, { tenantId: A, userId: userA }, (tx) =>
        tx.role.create({ data: { tenantId: B, key: 'agent', name: 'Evil' } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(prisma, { tenantId: A, userId: userA }, (tx) =>
        tx.auditLog.create({ data: { tenantId: B, action: 'forged' } }),
      ),
    ).rejects.toThrow();
  });

  it('cannot update or delete another tenant rows (silently affects 0 rows)', async () => {
    await withTenant(prisma, { tenantId: A, userId: userA }, async (tx) => {
      const upd = await tx.role.updateMany({ where: { id: roleB }, data: { name: 'hacked' } });
      expect(upd.count).toBe(0);
      const del = await tx.membership.deleteMany({ where: { tenantId: B } });
      expect(del.count).toBe(0);
    });
    const r = await owner.query('SELECT name FROM roles WHERE id=$1', [roleB]);
    expect(r.rows[0].name).toBe('Owner');
  });

  it('cannot move a row into another tenant via UPDATE', async () => {
    await expect(
      withTenant(prisma, { tenantId: A, userId: userA }, (tx) =>
        tx.invitation.updateMany({ data: { tenantId: B } }),
      ),
    ).rejects.toThrow();
  });

  it('membership SELECT by user spans that user\'s tenants only, and never allows cross-tenant writes', async () => {
    await withTenant(prisma, { tenantId: null, userId: userA }, async (tx) => {
      const rows = await tx.membership.findMany();
      expect(rows.map((m) => m.tenantId)).toEqual([A]);
      expect((await tx.tenant.findMany()).map((t) => t.id)).toEqual([A]);
    });
    await withTenant(prisma, { tenantId: null, userId: userA }, async (tx) => {
      const upd = await tx.membership.updateMany({ data: { status: 'DEACTIVATED' } });
      expect(upd.count).toBe(0);
    });
  });

  it('a forged tenant context exposes only that tenant plus the caller\'s own membership roles', async () => {
    // The DB cannot validate membership (the TenantGuard does, tested in the API suite). Even so, with tenant B
    // context userA sees tenant B rows plus ONLY the role attached to userA's own membership (needed for the
    // workspace switcher). Nothing else of tenant A's data (invitations, audit, other roles) is visible.
    await withTenant(prisma, { tenantId: B, userId: userA }, async (tx) => {
      expect((await tx.role.findMany()).map((r) => r.id).sort()).toEqual([roleA, roleB].sort());
      expect((await tx.invitation.findMany()).every((i) => i.tenantId === B)).toBe(true);
      expect((await tx.auditLog.findMany()).every((l) => l.tenantId === B)).toBe(true);
    });
  });
});

describe('audit log is append-only', () => {
  it('app role can INSERT and SELECT but not UPDATE or DELETE', async () => {
    await expect(
      withTenant(prisma, { tenantId: A }, (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(prisma, { tenantId: A }, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('invitation lookup helper', () => {
  it('finds an invitation by token hash without tenant context, and nothing for unknown hashes', async () => {
    await withTenant(prisma, { tenantId: null }, async (tx) => {
      const rows = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT * FROM find_invitation_by_token_hash(${`hash-${A}`})`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(A);
      const none = await tx.$queryRaw<unknown[]>`SELECT * FROM find_invitation_by_token_hash(${'nope'})`;
      expect(none).toHaveLength(0);
    });
  });
});

describe('withTenant input hardening', () => {
  it('rejects non-UUID tenant ids', async () => {
    await expect(withTenant(prisma, { tenantId: "x'; DROP TABLE tenants;--" }, async () => 1)).rejects.toThrow('Invalid tenant id');
  });
});
