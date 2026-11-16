import { expect, test } from '@playwright/test';
import { registerViaApi, loginViaUi, WEB } from '../helpers.ts';

test('the web app sends CSP and framing protections', async ({ request }) => {
  const res = await request.get('/login');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['x-powered-by']).toBeUndefined();
});

test('a `next` parameter can never send a signed-in user to another site', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'redirect');
  const offsite: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname.includes('evil')) offsite.push(r.url()); });
  for (const next of ['//evil.example/phish', '/\\evil.example/phish', 'https://evil.example', 'javascript:alert(1)']) {
    await page.context().clearCookies();
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await loginViaUi(page, acct);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    expect(new URL(page.url()).origin, `next=${next}`).toBe(WEB);
  }
  expect(offsite).toEqual([]);
});

test('no console CSP violations on the main screens (the policy does not break the app)', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'csp');
  const violations: string[] = [];
  page.on('console', (m) => { if (/content security policy|refused to/i.test(m.text())) violations.push(m.text()); });
  await loginViaUi(page, acct);
  for (const path of ['/dashboard', '/leads', '/inbox', '/billing', '/automations']) { await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); }
  expect(violations).toEqual([]);
});
