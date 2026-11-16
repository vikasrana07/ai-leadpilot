import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ENV, KMS_CLIENT } from '../common/tokens.js';
import type { Env } from '../config/env.js';

/** Wraps data keys with a master key. Local (env key) or AWS KMS (ADR-0007). Async because KMS is a network call. */
export interface MasterKeyProvider {
  /** Recorded on every sealed record so the right key can be found again (and so a migration knows what still needs re-wrapping). */
  readonly keyId: string;
  wrap(dataKey: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

export class LocalKeyProvider implements MasterKeyProvider {
  readonly keyId = 'local-1';
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('LOCAL_MASTER_KEY must decode to exactly 32 bytes');
  }
  async wrap(dataKey: Buffer): Promise<Buffer> { return gcmEncrypt(this.key, dataKey, 'dek'); }
  async unwrap(wrapped: Buffer): Promise<Buffer> { return gcmDecrypt(this.key, wrapped, 'dek'); }
}

/** The two KMS calls we use, so the real SDK client and a test double are interchangeable. */
export interface KmsLike {
  encrypt(i: { keyId: string; plaintext: Buffer; context: Record<string, string> }): Promise<Buffer>;
  decrypt(i: { keyId: string; ciphertext: Buffer; context: Record<string, string> }): Promise<Buffer>;
}

/** Real AWS KMS through the official SDK. NOT yet exercised against AWS (see ADR-0007). */
export function awsKmsClient(region: string): KmsLike {
  const client = new KMSClient({ region });
  return {
    async encrypt(i) {
      const r = await client.send(new EncryptCommand({ KeyId: i.keyId, Plaintext: i.plaintext, EncryptionContext: i.context }));
      if (!r.CiphertextBlob) throw new Error('KMS returned no ciphertext');
      return Buffer.from(r.CiphertextBlob);
    },
    async decrypt(i) {
      // KeyId is passed so a ciphertext produced under a different key can never be silently decrypted by the wrong CMK.
      const r = await client.send(new DecryptCommand({ KeyId: i.keyId, CiphertextBlob: i.ciphertext, EncryptionContext: i.context }));
      if (!r.Plaintext) throw new Error('KMS returned no plaintext');
      return Buffer.from(r.Plaintext);
    },
  };
}

/** Envelope: KMS encrypts only the 32-byte per-record data key; the secret itself never leaves the process. */
export class AwsKmsKeyProvider implements MasterKeyProvider {
  readonly keyId: string;
  constructor(private readonly kms: KmsLike, private readonly kmsKeyId: string) { this.keyId = `kms:${kmsKeyId}`; }
  wrap(dataKey: Buffer): Promise<Buffer> { return this.kms.encrypt({ keyId: this.kmsKeyId, plaintext: dataKey, context: { purpose: 'leadpilot-dek' } }); }
  unwrap(wrapped: Buffer): Promise<Buffer> { return this.kms.decrypt({ keyId: this.kmsKeyId, ciphertext: wrapped, context: { purpose: 'leadpilot-dek' } }); }
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function gcmDecrypt(key: Buffer, blob: Buffer, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export interface SealedSecret { ciphertext: string; wrappedKey: string; keyId: string }

/**
 * Envelope encryption for secrets: a fresh random data key per record encrypts the secret (AES-256-GCM), and the data key is wrapped
 * by the master key. `aad` (tenant + provider) is authenticated, so a ciphertext copied to another tenant's row fails to decrypt.
 * New records use the ACTIVE provider (`KEY_PROVIDER`); old records stay readable through the provider named by their recorded `keyId`
 * (the local key is always available while LOCAL_MASTER_KEY is set), and `rewrap` migrates a record to the active key without touching its ciphertext.
 */
@Injectable()
export class SecretBox {
  private readonly active: MasterKeyProvider;
  private readonly known = new Map<string, MasterKeyProvider>();
  private readonly kms: KmsLike | null;

  constructor(@Inject(ENV) env: Env, @Optional() @Inject(KMS_CLIENT) kms?: KmsLike) {
    const local = new LocalKeyProvider(env.LOCAL_MASTER_KEY);
    this.known.set(local.keyId, local);
    this.kms = env.KEY_PROVIDER === 'kms' || env.KMS_KEY_ID ? (kms ?? awsKmsClient(env.KMS_REGION ?? env.S3_REGION)) : null;
    if (env.KEY_PROVIDER === 'kms') {
      if (!env.KMS_KEY_ID || !this.kms) throw new Error('KEY_PROVIDER=kms needs KMS_KEY_ID');
      const p = new AwsKmsKeyProvider(this.kms, env.KMS_KEY_ID);
      this.known.set(p.keyId, p);
      this.active = p;
    } else this.active = local;
  }

  get activeKeyId(): string { return this.active.keyId; }

  private providerFor(keyId: string): MasterKeyProvider {
    const hit = this.known.get(keyId);
    if (hit) return hit;
    // A record sealed under an earlier KMS key (rotated away from the configured one) can still be opened: KMS holds the old key.
    if (keyId.startsWith('kms:') && this.kms) { const p = new AwsKmsKeyProvider(this.kms, keyId.slice(4)); this.known.set(keyId, p); return p; }
    throw new Error(`No key provider available for record key "${keyId}"`);
  }

  async seal(secret: Record<string, string>, aad: string): Promise<SealedSecret> {
    const dataKey = randomBytes(32);
    return {
      ciphertext: gcmEncrypt(dataKey, Buffer.from(JSON.stringify(secret)), aad).toString('base64'),
      wrappedKey: (await this.active.wrap(dataKey)).toString('base64'),
      keyId: this.active.keyId,
    };
  }

  async open(sealed: SealedSecret, aad: string): Promise<Record<string, string>> {
    const dataKey = await this.providerFor(sealed.keyId).unwrap(Buffer.from(sealed.wrappedKey, 'base64'));
    return JSON.parse(gcmDecrypt(dataKey, Buffer.from(sealed.ciphertext, 'base64'), aad).toString()) as Record<string, string>;
  }

  /** Re-wraps the data key under the active master key. Returns null when the record is already on it. The ciphertext is unchanged. */
  async rewrap(sealed: SealedSecret): Promise<SealedSecret | null> {
    if (sealed.keyId === this.active.keyId) return null;
    const dataKey = await this.providerFor(sealed.keyId).unwrap(Buffer.from(sealed.wrappedKey, 'base64'));
    return { ciphertext: sealed.ciphertext, wrappedKey: (await this.active.wrap(dataKey)).toString('base64'), keyId: this.active.keyId };
  }
}
