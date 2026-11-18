import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { PORTAL_AUDIENCE, dummyHash, deriveKey, generateCode, hashCode, hashIdentity, newPortalKey, safeEqualHex, signPortalSession, verifyPortalSession } from '../src/portal/portal-auth.js';
import { PORTAL_KEY_REGEX } from '@leadpilot/validation';

const SECRET = 'unit-test-access-secret-at-least-32-characters-long';
const portalKey = deriveKey(SECRET, 'lead-portal-session');
const codeKey = deriveKey(SECRET, 'lead-portal-code');

describe('portal security helpers', () => {
  it('generates 6-digit codes with leading zeros kept and a spread of values', () => {
    const codes = Array.from({ length: 400 }, generateCode);
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(380);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('hashes a code bound to the workspace, the identity and the code, and compares in constant time', () => {
    const id = hashIdentity(codeKey, 't1', '919812345678');
    const h = hashCode(codeKey, 't1', id, '123456');
    expect(safeEqualHex(h, hashCode(codeKey, 't1', id, '123456'))).toBe(true);
    expect(safeEqualHex(h, hashCode(codeKey, 't1', id, '123457'))).toBe(false);
    expect(safeEqualHex(h, hashCode(codeKey, 't2', id, '123456'))).toBe(false);                                  // another workspace
    expect(safeEqualHex(h, hashCode(codeKey, 't1', hashIdentity(codeKey, 't1', 'x@y.test'), '123456'))).toBe(false); // another identity
    expect(safeEqualHex(h, hashCode(deriveKey('another-secret-another-secret-123456', 'lead-portal-code'), 't1', id, '123456'))).toBe(false);
    expect(safeEqualHex(h, 'zz')).toBe(false); expect(safeEqualHex('', '')).toBe(false);
    expect(h).not.toContain('123456'); expect(id).not.toContain('919812345678');
    expect(safeEqualHex(h, dummyHash(codeKey))).toBe(false);
  });

  it('derives different keys per label, so one purpose can never stand in for another', () => { expect(portalKey.equals(codeKey)).toBe(false); expect(portalKey.equals(deriveKey(SECRET, 'lead-portal-session'))).toBe(true); });

  it('creates unguessable, URL-safe portal keys that match the shared pattern', () => {
    const keys = Array.from({ length: 50 }, newPortalKey);
    for (const k of keys) expect(k).toMatch(PORTAL_KEY_REGEX);
    expect(new Set(keys).size).toBe(50);
  });

  it('signs and verifies a session, and rejects another key, audience, issuer, expiry, or garbage', async () => {
    const t = await signPortalSession(portalKey, { sessionId: 's1', tenantId: 't1' });
    expect(await verifyPortalSession(portalKey, t)).toEqual({ sessionId: 's1', tenantId: 't1' });
    expect(await verifyPortalSession(codeKey, t)).toBeNull();
    const forge = (aud: string, iss = 'leadpilot', exp = '5m') => new SignJWT({ sid: 's1', tid: 't1' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(portalKey);
    expect(await verifyPortalSession(portalKey, await forge('tenant-app'))).toBeNull();            // a user token's audience
    expect(await verifyPortalSession(portalKey, await forge('widget'))).toBeNull();
    expect(await verifyPortalSession(portalKey, await forge(PORTAL_AUDIENCE, 'someone-else'))).toBeNull();
    expect(await verifyPortalSession(portalKey, await forge(PORTAL_AUDIENCE, 'leadpilot', '-1m'))).toBeNull();
    const noClaims = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer('leadpilot').setAudience(PORTAL_AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(portalKey);
    expect(await verifyPortalSession(portalKey, noClaims)).toBeNull();
    for (const bad of ['', 'abc', 'a.b.c', t.slice(0, -4) + 'AAAA']) expect(await verifyPortalSession(portalKey, bad)).toBeNull();
  });
});
