import { expect, test } from '@playwright/test';
import { createPlatformAdmin, registerViaApi, signInViaApi } from '../helpers.ts';

test('platform console: find a tenant, suspend it with a reason, see the tenant locked out, reactivate', async ({ page, browser, request }) => {
  const admin = await createPlatformAdmin('padmin');
  const acct = await registerViaApi(request, 'platform');

  // the tenant user is already inside their workspace
  const tenantCtx = await browser.newContext(); const tenant = await tenantCtx.newPage();
  await signInViaApi(tenant, acct);
  await tenant.goto('/leads');
  await expect(tenant.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible();

  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('MRR (ex-GST)')).toBeVisible();

  await page.getByRole('link', { name: 'Tenants' }).click();
  await page.getByLabel('Search').fill(acct.businessName);
  await page.getByRole('link', { name: acct.businessName }).click();
  await expect(page.getByRole('heading', { level: 1, name: acct.businessName })).toBeVisible();

  await page.getByRole('button', { name: 'Suspend' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('e2e: abuse report under review');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Suspended').first()).toBeVisible();

  // the tenant's next request is refused
  await tenant.reload();
  await expect(tenant.getByText(/do not have access|could not load|access/i).first()).toBeVisible();
  await expect(tenant.getByRole('heading', { level: 1, name: 'Leads' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('e2e: resolved with the customer');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
  await tenant.reload();
  await expect(tenant.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible();
  await tenantCtx.close();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/platform\/login/);
});
