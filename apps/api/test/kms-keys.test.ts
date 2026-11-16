import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { AwsKmsKeyProvider, type KmsLike, SecretBox } from '../src/crypto/secret-box.js';
import { rewrapAll } from '../src/scripts/rewrap-secrets.js';

/**
 * MOCK KMS: an in-memory stand-in that behaves like KMS for what we use (per-key secret material, encryption context bound into the
 * ciphertext, decrypt refuses the wrong key or context). It is NOT AWS: nothing here was run against real KMS (see ADR-0007).
 */
class FakeKms implements KmsLike {
  private readonly keys = new Map<string, Buffer>();
  calls = { encrypt: 0, decrypt: 0 };
  private key(id: string): Buffer { let k = this.keys.get(id); if (!k) { k = randomBytes(32); this.keys.set(id, k); } return k; }
  async encrypt(i: { keyId: string; plaintext: Buffer; context: Record<string, string> }): Promise<Buffer> {
    this.calls.encrypt++;
    const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.key(i.keyId), iv); c.setAAD(Buffer.from(JSON.stringify(i.context)));
    return Buffer.concat([Buffer.from(i.keyId + '|'), iv, c.update(i.plaintext), c.final(), c.getAuthTag()]);
  }
  async decrypt(i: { keyId: string; ciphertext: Buffer; context: Record<string, string> }): Promise<Buffer> {
    this.calls.decrypt++;
    const sep = i.ciphertext.indexOf('|'); const made = i.ciphertext.subarray(0, sep).toString();
    if (made !== i.keyId) throw new Error('IncorrectKeyException');
    const body = i.ciphertext.subarray(sep + 1); const d = createDecipheriv('aes-256-gcm', this.key(i.keyId), body.subarray(0, 12));
    d.setAAD(Buffer.from(JSON.stringify(i.context))); d.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([d.update(body.subarray(12, body.length - 16)), d.final()]);
  }
}
const base = { LOCAL_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'), S3_REGION: 'ap-south-1' };
const env = (o: Record<string, string>) => ({ ...base, ...o }) as never;

describe('master key providers (mock KMS)', () => {
  it('seals under KMS, records the key id, never stores the data key in clear, and opens it again', async () => {
    const kms = new FakeKms(); const box = new SecretBox(env({ KEY_PROVIDER: 'kms', KMS_KEY_ID: 'key-A' }), kms);
    const sealed = await box.seal({ accessToken: 'EAAG-secret' }, 'tenant:whatsapp');
    expect(sealed.keyId).toBe('kms:key-A'); expect(JSON.stringify(sealed)).not.toContain('EAAG-secret');
    expect(await box.open(sealed, 'tenant:whatsapp')).toEqual({ accessToken: 'EAAG-secret' });
    await expect(box.open(sealed, 'other-tenant:whatsapp')).rejects.toThrow(); // AAD still binds the record to its tenant
  });

  it('fails closed with the wrong KMS key or a tampered wrapped key', async () => {
    const kms = new FakeKms();
    const a = new SecretBox(env({ KEY_PROVIDER: 'kms', KMS_KEY_ID: 'key-A' }), kms);
    const sealed = await a.seal({ k: 'v' }, 'aad');
    // a record that claims to be under key-B but was wrapped by key-A cannot be opened
    await expect(a.open({ ...sealed, keyId: 'kms:key-B' }, 'aad')).rejects.toThrow();
    const raw = Buffer.from(sealed.wrappedKey, 'base64'); raw[raw.length - 3] = (raw[raw.length - 3] as number) ^ 1;
    await expect(a.open({ ...sealed, wrappedKey: raw.toString('base64') }, 'aad')).rejects.toThrow();
    // and with no KMS configured at all, a KMS record is unreadable rather than guessed at
    await expect(new SecretBox(env({ KEY_PROVIDER: 'local' })).open(sealed, 'aad')).rejects.toThrow(/No key provider/);
  });

  it('keeps local-key records readable after switching to KMS, and re-wraps them without touching the ciphertext', async () => {
    const kms = new FakeKms();
    const local = new SecretBox(env({ KEY_PROVIDER: 'local' }));
    const old = await local.seal({ appSecret: 'whsec_old' }, 'aad');
    expect(old.keyId).toBe('local-1');
    const box = new SecretBox(env({ KEY_PROVIDER: 'kms', KMS_KEY_ID: 'key-A' }), kms);
    expect(await box.open(old, 'aad')).toEqual({ appSecret: 'whsec_old' }); // still readable
    const moved = await box.rewrap(old);
    expect(moved).not.toBeNull(); expect(moved?.keyId).toBe('kms:key-A'); expect(moved?.ciphertext).toBe(old.ciphertext);
    expect(await box.open(moved!, 'aad')).toEqual({ appSecret: 'whsec_old' });
    expect(await box.rewrap(moved!)).toBeNull(); // already on the active key
  });

  it('rotates to a new KMS key: old records stay readable (KMS holds the old key) and re-wrap to the new one', async () => {
    const kms = new FakeKms();
    const v1 = new SecretBox(env({ KEY_PROVIDER: 'kms', KMS_KEY_ID: 'key-1' }), kms);
    const rec = await v1.seal({ t: 'x' }, 'aad');
    const v2 = new SecretBox(env({ KEY_PROVIDER: 'kms', KMS_KEY_ID: 'key-2' }), kms);
    expect(await v2.open(rec, 'aad')).toEqual({ t: 'x' });
    const moved = await v2.rewrap(rec);
    expect(moved?.keyId).toBe('kms:key-2'); expect(await v2.open(moved!, 'aad')).toEqual({ t: 'x' });
  });

  it('the KMS provider binds an encryption context (a wrapped key is useless for any other purpose)', async () => {
    const kms = new FakeKms(); const p = new AwsKmsKeyProvider(kms, 'key-A');
    const wrapped = await p.wrap(Buffer.alloc(32, 1));
    await expect(kms.decrypt({ keyId: 'key-A', ciphertext: wrapped, context: { purpose: 'something-else' } })).rejects.toThrow();
  });

  it('refuses to start in KMS mode without a key id', () => {
    expect(() => loadEnv({ WEB_ORIGIN: 'http://x.test', DATABASE_URL: 'postgresql://a:b@h/d', JWT_ACCESS_SECRET: 'x'.repeat(40), LOCAL_MASTER_KEY: base.LOCAL_MASTER_KEY, KEY_PROVIDER: 'kms' })).toThrow(/KMS_KEY_ID/);
    expect(() => loadEnv({ NODE_ENV: 'production', WEB_ORIGIN: 'https://x.test', DATABASE_URL: 'postgresql://a:b@h/d', JWT_ACCESS_SECRET: 'x'.repeat(40), LOCAL_MASTER_KEY: base.LOCAL_MASTER_KEY })).toThrow(/KEY_PROVIDER=local is not allowed in production/);
  });
});

describe('local -> KMS migration of stored records', () => {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  afterAll(async () => { await owner.end(); });
  it('re-wraps integration_credentials and mfa_credentials rows in place, idempotently, and supports --dry-run', async () => {
    const kms = new FakeKms();
    const local = new SecretBox(env({ KEY_PROVIDER: 'local' }));
    const tenant = (await owner.query("INSERT INTO tenants (id, name, email, industry, updated_at) VALUES (gen_random_uuid(), 'it-kms-migrate', 'k@example.test', 'real_estate', now()) RETURNING id")).rows[0].id as string;
    try {
      const sealed = await local.seal({ accessToken: 'tok' }, `${tenant}:whatsapp`);
      await owner.query("INSERT INTO integration_credentials (id, tenant_id, provider, ciphertext, wrapped_key, key_id, updated_at) VALUES (gen_random_uuid(), $1, 'whatsapp', $2, $3, $4, now())", [tenant, sealed.ciphertext, sealed.wrappedKey, sealed.keyId]);
      const box = new SecretBox(env({ KEY_PROVIDER: 'kms', KMS_KEY_ID: 'key-A' }), kms);
      const dry = (await rewrapAll(owner, box, { dryRun: true })).find((r) => r.table === 'integration_credentials');
      expect(dry?.rewrapped).toBeGreaterThanOrEqual(1);
      expect((await owner.query("SELECT key_id FROM integration_credentials WHERE tenant_id=$1", [tenant])).rows[0].key_id).toBe('local-1'); // dry run changed nothing
      await rewrapAll(owner, box); // (rows sealed by OTHER keys in a shared dev DB are reported as failed, never altered)
      const row = (await owner.query("SELECT ciphertext, wrapped_key, key_id FROM integration_credentials WHERE tenant_id=$1", [tenant])).rows[0];
      expect(row.key_id).toBe('kms:key-A'); expect(row.ciphertext).toBe(sealed.ciphertext);
      expect(await box.open({ ciphertext: row.ciphertext, wrappedKey: row.wrapped_key, keyId: row.key_id }, `${tenant}:whatsapp`)).toEqual({ accessToken: 'tok' });
      expect((await rewrapAll(owner, box)).every((r) => r.rewrapped === 0)).toBe(true); // idempotent
    } finally { await owner.query('DELETE FROM integration_credentials WHERE tenant_id=$1', [tenant]); await owner.query('DELETE FROM tenants WHERE id=$1', [tenant]); }
  });
});
