import pg from 'pg';
import { PERMISSIONS } from '@leadpilot/shared-types';

/** Upserts the permission catalogue. Runs as the OWNER role (the app role only has SELECT on `permissions`). */
export async function syncPermissions(connectionString: string): Promise<number> {
  const pool = new pg.Pool({ connectionString });
  try {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await pool.query(
        'INSERT INTO permissions (key, description) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description',
        [key, description],
      );
    }
    return Object.keys(PERMISSIONS).length;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const n = await syncPermissions(url);
  console.log(`Synced ${n} permissions`);
}
