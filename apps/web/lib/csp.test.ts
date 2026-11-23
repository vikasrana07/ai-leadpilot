import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce } from './csp';

describe('Strict Nonce-based CSP', () => {
  it('generates a unique non-empty base64 nonce', () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
    // Base64 format check
    expect(nonce1).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('builds CSP with nonce and removes unsafe-inline in production', () => {
    const nonce = 'abcd1234test';
    const csp = buildCsp({ nonce, isDev: false, apiOrigin: 'https://api.leadpilot.io' });

    // Verify nonce presence in script-src
    expect(csp).toContain(`'nonce-${nonce}'`);

    // Verify strict-dynamic is included in production
    expect(csp).toContain("'strict-dynamic'");

    // Verify unsafe-inline is NOT in script-src
    const scriptSrcMatch = csp.match(/script-src ([^;]+)/);
    expect(scriptSrcMatch).not.toBeNull();
    const scriptSrc = scriptSrcMatch![1]!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    // Verify connect-src includes apiOrigin
    expect(csp).toContain('https://api.leadpilot.io');
  });

  it('includes unsafe-eval in development mode for Fast Refresh', () => {
    const nonce = 'devnonce123';
    const csp = buildCsp({ nonce, isDev: true });

    const scriptSrcMatch = csp.match(/script-src ([^;]+)/);
    expect(scriptSrcMatch).not.toBeNull();
    const scriptSrc = scriptSrcMatch![1]!;
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).not.toContain("'strict-dynamic'");
  });
});
