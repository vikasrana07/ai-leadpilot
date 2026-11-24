import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Audit finding S-09: tenant-scoped rows must not be able to outlive (or be attached to) a workspace that does not exist. Every table with a
 * tenant_id column needs a validated foreign key to tenants, except the records purge_tenant() keeps on purpose after deletion.
 */
const KEPT_AFTER_DELETION = ['invoices', 'payments', 'platform_audit_logs'];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
afterAll(() => pool.end());

describe('tenant foreign keys', () => {
  it('every tenant-scoped table references tenants (validated), apart from the deliberately retained ones', async () => {
    const { rows } = await pool.query<{ tbl: string }>(`
      SELECT c.relname AS tbl FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
        AND c.relname <> 'tenants' AND c.relname <> ALL ($1)
        AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.convalidated AND k.conrelid = c.oid AND k.confrelid = 'tenants'::regclass AND k.conkey = ARRAY[a.attnum])
      ORDER BY 1`, [KEPT_AFTER_DELETION]);
    expect(rows.map((r) => r.tbl)).toEqual([]);
  });

  it('the retained tables really are unconstrained, so billing and platform audit history survive a purge', async () => {
    const { rows } = await pool.query(`SELECT conrelid::regclass::text AS tbl FROM pg_constraint WHERE contype = 'f' AND confrelid = 'tenants'::regclass AND conrelid::regclass::text = ANY ($1)`, [KEPT_AFTER_DELETION]);
    expect(rows).toEqual([]);
  });
});
