import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import { SecretBox } from '../crypto/secret-box.js';

/**
 * Re-wraps every stored data key under the ACTIVE master key (KEY_PROVIDER). Use it to move from the local key to KMS, or to a new
 * KMS key. Only the small wrapped data key changes; the encrypted secret and its tenant-bound AAD are untouched, so nothing needs the
 * tenant context. Idempotent and resumable: rows already on the active key are skipped. Runs as the schema OWNER (bypasses RLS).
 *
 *   KEY_PROVIDER=kms KMS_KEY_ID=arn:aws:kms:... DATABASE_OWNER_URL=... node dist/scripts/rewrap-secrets.js [--dry-run]
 * Keep LOCAL_MASTER_KEY set while migrating (old records are read with it). After a clean run, no row has key_id = local-1.
 */
const TABLES = ['integration_credentials', 'mfa_credentials'] as const;

export interface RewrapReport { table: string; scanned: number; rewrapped: number; failed: number }

export async function rewrapAll(pool: pg.Pool, box: SecretBox, opts: { dryRun?: boolean } = {}): Promise<RewrapReport[]> {
  const out: RewrapReport[] = [];
  for (const table of TABLES) {
    const r: RewrapReport = { table, scanned: 0, rewrapped: 0, failed: 0 };
    const rows = (await pool.query<{ id: string; ciphertext: string; wrapped_key: string; key_id: string }>(
      table === 'mfa_credentials'
        ? `SELECT subject_type || ':' || subject_id AS id, ciphertext, wrapped_key, key_id FROM ${table} WHERE key_id <> $1`
        : `SELECT id::text AS id, ciphertext, wrapped_key, key_id FROM ${table} WHERE key_id <> $1`, [box.activeKeyId])).rows;
    for (const row of rows) {
      r.scanned++;
      try {
        const next = await box.rewrap({ ciphertext: row.ciphertext, wrappedKey: row.wrapped_key, keyId: row.key_id });
        if (!next) continue;
        if (!opts.dryRun) {
          const where = table === 'mfa_credentials' ? `subject_type || ':' || subject_id = $3` : `id::text = $3`;
          // Compare-and-set on the old key id: a concurrent run cannot clobber a row another run already migrated.
          await pool.query(`UPDATE ${table} SET wrapped_key = $1, key_id = $2 WHERE ${where} AND key_id = $4`, [next.wrappedKey, next.keyId, row.id, row.key_id]);
        }
        r.rewrapped++;
      } catch { r.failed++; }
    }
    out.push(r);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required (the owner role; the application role cannot see other tenants\' rows)');
  const env = loadEnv();
  const pool = new pg.Pool({ connectionString: url });
  const dryRun = process.argv.includes('--dry-run');
  const reports = await rewrapAll(pool, new SecretBox(env), { dryRun });
  for (const r of reports) console.log(`${r.table}: scanned ${r.scanned}, ${dryRun ? 'would re-wrap' : 're-wrapped'} ${r.rewrapped}, failed ${r.failed}`);
  await pool.end();
  if (reports.some((r) => r.failed > 0)) process.exit(1);
}
