import { createHash, randomBytes } from 'node:crypto';

/** Opaque 256-bit secret. Only the SHA-256 hash is stored, so a DB leak does not leak usable tokens. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
