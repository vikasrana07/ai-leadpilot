import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s step) on node:crypto: no dependency. */
export const STEP_SECONDS = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(): string { return base32Encode(randomBytes(20)); }

/** RFC 4226 HOTP value for `counter`. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = (h[h.length - 1] as number) & 15;
  const bin = (((h[o] as number) & 0x7f) << 24) | (((h[o + 1] as number) & 0xff) << 16) | (((h[o + 2] as number) & 0xff) << 8) | ((h[o + 3] as number) & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks `code` against steps now-window..now+window (default ±1 = ±30 s of clock skew). Returns the matching step, or null.
 * `lastUsedStep` makes a code single-use: only a step strictly greater than the last accepted one can match, so replaying a code
 * (or an older one inside the window) fails.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastUsedStep: number, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32); const now = stepAt(nowMs);
  let hit: number | null = null;
  // Every candidate is compared (no early exit) and constant-time, so timing does not reveal which step matched.
  for (let step = now - window; step <= now + window; step++) {
    const expected = Buffer.from(hotp(secret, step)); const got = Buffer.from(code);
    if (timingSafeEqual(expected, got) && step > lastUsedStep && (hit === null || step > hit)) hit = step;
  }
  return hit;
}

export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
