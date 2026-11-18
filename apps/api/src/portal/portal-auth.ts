import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

/** Cookie that carries a customer-portal session. Added to the CSRF cookie list in common/middleware.ts. */
export const PORTAL_COOKIE = 'lp_portal';
export const PORTAL_AUDIENCE = 'lead-portal';
export const PORTAL_SESSION_MINUTES = 60;
export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
/** At most this many codes per typed identity in the window: the main brake on guessing and on spamming a customer. */
export const MAX_CODES_PER_WINDOW = 3;
export const CODE_WINDOW_MINUTES = 15;

/**
 * Keys are DERIVED from the access-token secret with a label, so a portal token can never verify as a user, widget or support token
 * (different key AND audience) and code hashes cannot be replayed elsewhere. No new secret to manage.
 */
export function deriveKey(secret: string, label: string): Buffer { return createHmac('sha256', secret).update(`leadpilot:${label}`).digest(); }

/** A 6-digit code from the OS random source (never Math.random). */
export function generateCode(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }

/** What is stored: an HMAC bound to the workspace, the identity and the code, so a stolen database row does not reveal codes. */
export function hashCode(key: Buffer, tenantId: string, identityHash: string, code: string): string {
  return createHmac('sha256', key).update(`code:${tenantId}:${identityHash}:${code}`).digest('hex');
}

/** A keyed hash of the phone/email the person typed (never stored in the clear). */
export function hashIdentity(key: Buffer, tenantId: string, normalisedIdentity: string): string {
  return createHmac('sha256', key).update(`id:${tenantId}:${normalisedIdentity}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'); const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** A hash that no real code can equal, compared when there is nothing to compare, so the work done does not reveal whether a code exists. */
export function dummyHash(key: Buffer): string { return createHmac('sha256', key).update(`dummy:${randomBytes(8).toString('hex')}`).digest('hex'); }

/** Public portal key for the address (/p/<key>): unguessable, URL-safe. */
export function newPortalKey(): string { return `pp_${randomBytes(18).toString('base64url')}`; }

export interface PortalClaims { sessionId: string; tenantId: string }

export async function signPortalSession(key: Buffer, c: PortalClaims): Promise<string> {
  return new SignJWT({ sid: c.sessionId, tid: c.tenantId }).setProtectedHeader({ alg: 'HS256' }).setIssuer('leadpilot').setAudience(PORTAL_AUDIENCE).setIssuedAt().setExpirationTime(`${PORTAL_SESSION_MINUTES}m`).sign(key);
}

/** Returns the claims, or null for anything that is not a valid, unexpired portal token (wrong key, audience, issuer, shape). */
export async function verifyPortalSession(key: Buffer, token: string): Promise<PortalClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: 'leadpilot', audience: PORTAL_AUDIENCE, algorithms: ['HS256'] });
    if (typeof payload.sid !== 'string' || typeof payload.tid !== 'string') return null;
    return { sessionId: payload.sid, tenantId: payload.tid };
  } catch { return null; }
}
