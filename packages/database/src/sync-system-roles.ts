import pg from 'pg';
import { SYSTEM_ROLES, type SystemRoleKey } from '@leadpilot/shared-types';

/**
 * Brings every tenant's SYSTEM roles in line with the permission sets defined in code (`SYSTEM_ROLES`).
 * Needed because roles are copied into tenant rows at creation: without this, a permission added in a release would
 * never reach existing workspaces. Adds missing grants and removes grants that are no longer part of a system role.
 * Idempotent. Runs with the OWNER connection (the app role cannot cross tenants).
 */
export async function syncSystemRoles(ownerUrl: string): Promise<{ added: number; removed: number }> {
  const pool = new pg.Pool({ connectionString: ownerUrl });
  let added = 0;
  let removed = 0;
  try {
    for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
      const wanted = [...SYSTEM_ROLES[key].permissions] as string[];
      const add = await pool.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_key)
         SELECT r.tenant_id, r.id, p.key FROM roles r CROSS JOIN permissions p
         WHERE r.key = $1 AND r.is_system AND p.key = ANY($2)
           AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_key = p.key)`,
        [key, wanted],
      );
      added += add.rowCount ?? 0;
      const del = await pool.query(
        `DELETE FROM role_permissions rp USING roles r WHERE rp.role_id = r.id AND r.key = $1 AND r.is_system AND NOT (rp.permission_key = ANY($2))`,
        [key, wanted],
      );
      removed += del.rowCount ?? 0;
    }
    return { added, removed };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const r = await syncSystemRoles(url);
  console.log(`System roles synced: +${r.added} / -${r.removed} grants`);
}
