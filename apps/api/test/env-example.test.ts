import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

/** The documented .env.example must itself be a valid configuration once the three required secrets are filled (this is what CI does). */
describe('.env.example', () => {
  const parse = (text: string) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const example = parse(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

  it('loads with only the required secrets added, and empty optional values count as unset', () => {
    const env = loadEnv({ ...example, JWT_ACCESS_SECRET: 'x'.repeat(48), LOCAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') });
    expect(env.PLATFORM_JWT_SECRET).toBeUndefined(); expect(env.SMTP_USER).toBeUndefined(); expect(env.RAZORPAY_MODE).toBe('mock');
  });

  it('refuses unsafe production configuration', () => {
    const prod = { ...example, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(48), LOCAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') };
    expect(() => loadEnv(prod)).toThrow(/mock/);
    expect(() => loadEnv({ ...prod, SMTP_USER: 'u' })).toThrow();
  });
});
