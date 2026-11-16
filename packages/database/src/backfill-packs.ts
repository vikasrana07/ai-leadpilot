import pg from 'pg';
import { applyIndustryPack, createPrismaClient, withTenant } from './index.js';

/** Applies the Industry Pack to any tenant that predates it. Idempotent. Runs with the OWNER connection. */
export async function backfillPacks(ownerUrl: string, appUrl: string): Promise<number> {
  const pool = new pg.Pool({ connectionString: ownerUrl });
  const prisma = createPrismaClient(appUrl);
  try {
    const { rows } = await pool.query<{ id: string; industry: string }>(
      `SELECT t.id, t.industry FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.tenant_id = t.id)`,
    );
    for (const t of rows) await withTenant(prisma, { tenantId: t.id }, (tx) => applyIndustryPack(tx, t.id, t.industry));
    return rows.length;
  } finally {
    await pool.end();
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const owner = process.env.DATABASE_OWNER_URL;
  const app = process.env.DATABASE_URL;
  if (!owner || !app) throw new Error('DATABASE_OWNER_URL and DATABASE_URL are required');
  console.log(`Industry packs applied to ${await backfillPacks(owner, app)} tenant(s)`);
}
