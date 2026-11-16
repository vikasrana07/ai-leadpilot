import { expect, test } from '@playwright/test';
import { registerViaApi, signInViaApi } from '../helpers.ts';

// Runs against the MOCK payment provider (the UI says so): its simulator buttons push signed, Razorpay-shaped events through the real webhook code.
// Nothing here proves Razorpay itself works; that needs test-mode keys.
test('trial -> billing details -> subscribe -> simulated payment -> GST invoice', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'billing');
  await signInViaApi(page, acct);
  await page.goto('/billing');

  await expect(page.getByRole('heading', { level: 1, name: /Subscription & Billing/ })).toBeVisible();
  await expect(page.getByText('Free trial')).toBeVisible();
  await expect(page.getByText(/days? left/)).toBeVisible();
  await expect(page.getByText('Test mode: no real payment')).toBeVisible();

  await page.getByRole('button', { name: 'Billing details' }).click();
  await page.getByLabel('Legal / business name').fill('E2E Realty Pvt Ltd');
  await page.getByLabel('Address').fill('12 MG Road, Indiranagar');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Billing details saved')).toBeVisible();

  // plan cards are ordered Starter, Growth, Premium; the trial plan is Growth
  await page.getByRole('button', { name: 'Subscribe' }).nth(1).click();
  await page.getByRole('button', { name: 'Payment authorised' }).click();
  await expect(page.getByText('Current plan')).toBeVisible();
  await page.getByRole('button', { name: 'Payment succeeded (invoice)' }).click();

  const row = page.getByRole('row', { name: /LP\/\d{4}-\d{2}\/\d{6}/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('₹11,798.82');

  const popup = page.context().waitForEvent('page');
  await row.getByRole('link', { name: 'View' }).click();
  const invoice = await popup;
  await expect(invoice.getByText('Tax Invoice')).toBeVisible();
  await expect(invoice.getByText('CGST @ 9%')).toBeVisible();
  await expect(invoice.getByText('SGST @ 9%')).toBeVisible();
  await expect(invoice.getByText('IGST')).toHaveCount(0);
  await invoice.close();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
