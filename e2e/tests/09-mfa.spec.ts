import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerViaApi, WEB } from '../helpers';

/** RFC 6238 on node:crypto, independent of the product code (so a bug there cannot hide here). */
function totp(base32: string, offset = 0): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let v = 0; const bytes: number[] = [];
  for (const c of base32.replace(/\s/g, '')) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest(); const o = (h[h.length - 1] as number) & 15;
  return String((((h[o] as number) & 0x7f) << 24 | (h[o + 1] as number) << 16 | (h[o + 2] as number) << 8 | (h[o + 3] as number)) % 1_000_000).padStart(6, '0');
}

test('two-step verification: set it up in Security, then sign-in needs the code (and a recovery code works once)', async ({ page, request }) => {
  const a = await registerViaApi(request, 'mfa');
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(a.email); await page.getByLabel('Password').fill(a.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/dashboard');

  await page.goto(`${WEB}/security`);
  await page.getByRole('button', { name: 'Set up' }).click();
  const secret = (await page.getByLabel('Setup key').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel(/Enter the 6-digit code/).fill('000000');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /not valid/i })).toBeVisible();
  await page.getByLabel(/Enter the 6-digit code/).fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const codes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allInnerTexts();
  expect(codes).toHaveLength(10);
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled(); // cannot dismiss before acknowledging
  await page.getByLabel('I have saved these codes').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  // sign out, then password alone no longer signs in
  await page.context().clearCookies();
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(a.email); await page.getByLabel('Password').fill(a.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Authentication code')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Authentication code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /not valid/i })).toBeVisible();
  await page.getByLabel('Authentication code').fill(totp(secret, 1)); // next step: replay protection forbids reusing the set-up code's step
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/dashboard');

  // a recovery code signs in once
  await page.context().clearCookies();
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(a.email); await page.getByLabel('Password').fill(a.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code').fill(codes[0] as string);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/dashboard');
});
