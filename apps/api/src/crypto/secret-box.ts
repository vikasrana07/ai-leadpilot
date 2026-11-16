import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

/** Wraps data keys with a master key. Production swaps this for a KMS-backed provider (ADR-0005). */
export interface MasterKeyProvider {
  readonly keyId: string;
  wrap(dataKey: Buffer): Buffer;
  unwrap(wrapped: Buffer): Buffer;
}

export class LocalKeyProvider implements MasterKeyProvider {
  readonly keyId = 'local-1';
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('LOCAL_MASTER_KEY must decode to exactly 32 bytes');
  }
  wrap(dataKey: Buffer): Buffer { return gcmEncrypt(this.key, dataKey, 'dek'); }
  unwrap(wrapped: Buffer): Buffer { return gcmDecrypt(this.key, wrapped, 'dek'); }
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
 * Envelope encryption for integration secrets: a fresh random data key per record encrypts the secret (AES-256-GCM), and
 * the data key is wrapped by the master key. `aad` (tenant + provider) is authenticated, so a ciphertext copied to another
 * tenant's row fails to decrypt.
 */
@Injectable()
export class SecretBox {
  private readonly provider: MasterKeyProvider;
  constructor(@Inject(ENV) env: Env) { this.provider = new LocalKeyProvider(env.LOCAL_MASTER_KEY); }

  seal(secret: Record<string, string>, aad: string): SealedSecret {
    const dataKey = randomBytes(32);
    return {
      ciphertext: gcmEncrypt(dataKey, Buffer.from(JSON.stringify(secret)), aad).toString('base64'),
      wrappedKey: this.provider.wrap(dataKey).toString('base64'),
      keyId: this.provider.keyId,
    };
  }

  open(sealed: SealedSecret, aad: string): Record<string, string> {
    const dataKey = this.provider.unwrap(Buffer.from(sealed.wrappedKey, 'base64'));
    return JSON.parse(gcmDecrypt(dataKey, Buffer.from(sealed.ciphertext, 'base64'), aad).toString()) as Record<string, string>;
  }
}
