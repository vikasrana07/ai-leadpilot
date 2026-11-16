import { ownerPool, RUN } from './helpers.ts';

/**
 * Removes everything this run created: users and platform admins by the unique email pattern, then every tenant they belonged to, with
 * all tenant-owned rows. Foreign keys decide the deletion order, so each table is retried until nothing more can be removed.
 */
export default async function teardown(): Promise<void> {
  const pool = ownerPool();
  try {
    const like = `e2e-${RUN}-%`;
    const tenantIds = (await pool.query('SELECT DISTINCT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email LIKE $1', [like])).rows.map((r) => r.tenant_id as string);
    if (tenantIds.length) {
      const subs = (await pool.query('SELECT provider_subscription_id FROM subscriptions WHERE tenant_id = ANY($1) AND provider_subscription_id IS NOT NULL', [tenantIds])).rows.map((r) => r.provider_subscription_id as string);
      if (subs.length) await pool.query("DELETE FROM billing_events WHERE payload->'payload'->'subscription'->'entity'->>'id' = ANY($1)", [subs]).catch(() => undefined);
      const tables = (await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name NOT IN ('tenants', 'platform_audit_logs')`)).rows.map((r) => r.table_name as string);
      let pending = tables;
      for (let pass = 0; pass < 8 && pending.length; pass++) {
        const next: string[] = [];
        for (const t of pending) { try { await pool.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1)`, [tenantIds]); } catch { next.push(t); } }
        pending = next;
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [tenantIds]).catch(() => undefined);
    }
    await pool.query('DELETE FROM users WHERE email LIKE $1', [like]).catch(() => undefined);
    await pool.query('DELETE FROM platform_audit_logs WHERE admin_id IN (SELECT id FROM platform_admins WHERE email LIKE $1)', [like]).catch(() => undefined);
    await pool.query('DELETE FROM platform_admins WHERE email LIKE $1', [like]).catch(() => undefined);
  } finally { await pool.end(); }
}
