import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

/**
 * Audit finding S-18: platform-admin MFA was off by default (`.env.example` shipped PLATFORM_REQUIRE_MFA=false), although the console can
 * suspend tenants and open support sessions. It is now ON by default in production, and production refuses to boot with it off unless the
 * risk is acknowledged explicitly (the same pattern as ALLOW_LOCAL_KEY_IN_PRODUCTION and TURNSTILE_ALLOW_OFF_IN_PRODUCTION).
 */
const parse = (text: string) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const example = parse(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

/** A complete, valid production configuration (every mock/offline mode replaced by its live counterpart). */
const production = (over: Record<string, string> = {}) => ({
  ...example,
  JWT_ACCESS_SECRET: 'x'.repeat(48), LOCAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  NODE_ENV: 'production', WEB_ORIGIN: 'https://app.example.test',
  WHATSAPP_MODE: 'live', EMBEDDED_SIGNUP_MODE: 'off', VIRUS_SCAN_MODE: 'clamav', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test',
  KEY_PROVIDER: 'kms', KMS_KEY_ID: 'alias/test', TURNSTILE_MODE: 'live', TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k',
  RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24), SELLER_GSTIN: '29ABCDE1234F1Z5',
  PLATFORM_JWT_SECRET: 'p'.repeat(48), TRACKING_SECRET: 't'.repeat(32),
  ...over,
});

describe('platform admin MFA defaults', () => {
  it('the fixture is a valid production configuration (so the cases below isolate the MFA rule)', () => {
    expect(() => loadEnv(production())).not.toThrow();
  });

  it('is ON in production when unset (the shipped .env.example leaves it unset)', () => {
    expect(loadEnv(production()).PLATFORM_REQUIRE_MFA).toBe(true);
    expect(loadEnv(production({ PLATFORM_REQUIRE_MFA: '' })).PLATFORM_REQUIRE_MFA).toBe(true); // `KEY=` means unset
  });

  it('stays off by default outside production, so local development and the e2e suite are unaffected', () => {
    const dev = { ...example, JWT_ACCESS_SECRET: 'x'.repeat(48), LOCAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') };
    expect(loadEnv(dev).PLATFORM_REQUIRE_MFA).toBe(false);
    expect(loadEnv({ ...dev, PLATFORM_REQUIRE_MFA: 'true' }).PLATFORM_REQUIRE_MFA).toBe(true);
  });

  it('production refuses to boot with it explicitly off, unless the risk is acknowledged', () => {
    expect(() => loadEnv(production({ PLATFORM_REQUIRE_MFA: 'false' }))).toThrow(/PLATFORM_REQUIRE_MFA.*mandatory in production/);
    const env = loadEnv(production({ PLATFORM_REQUIRE_MFA: 'false', PLATFORM_ALLOW_NO_MFA_IN_PRODUCTION: 'true' }));
    expect(env.PLATFORM_REQUIRE_MFA).toBe(false);
  });

  it('does not matter when the platform console is disabled (no PLATFORM_JWT_SECRET)', () => {
    expect(() => loadEnv(production({ PLATFORM_JWT_SECRET: '', PLATFORM_REQUIRE_MFA: 'false' }))).not.toThrow();
  });
});
