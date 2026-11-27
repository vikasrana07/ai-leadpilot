import { expect, request as playwrightRequest, test } from '@playwright/test';
import { API, api, registerViaApi, signInViaApi } from '../helpers.ts';

/** Portal email parsing: enable the private webhook in Integrations, feed it a portal enquiry, and the lead appears. */
test('enable portal email parsing, receive a portal enquiry, and see the parsed email in the log', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'portalmail');
  await signInViaApi(page, acct);

  await page.goto('/integrations');
  const card = page.getByTestId('portal-email-card');
  await expect(card.getByText('Off')).toBeVisible();
  await card.getByRole('button', { name: 'Enable portal email parsing' }).click();
  await expect(page.getByText('Portal email parsing updated')).toBeVisible();
  await expect(card.getByText('Active')).toBeVisible();

  const endpoint = (await card.locator('code').innerText()).trim();
  const path = endpoint.slice(endpoint.indexOf('/webhooks/portal-email/'));
  expect(path).toMatch(/^\/webhooks\/portal-email\/pe_[\w-]{20,}$/);

  // a portal enquiry arrives as the email gateway would post it: a bare server-to-server request, no cookies (the registration cookies
  // on `request` would, rightly, trip the API's CSRF guard)
  const gateway = await playwrightRequest.newContext();
  const hook = await gateway.post(`${API}${path}`, { data: { from: 'alerts@99acres.com', subject: '99acres Buyer Enquiry E2E', text: 'Name: Amit Shah\nPhone: +91 98200 12345\nLocation: Baner' } });
  expect(hook.status()).toBe(200);
  expect(await hook.json()).toMatchObject({ ok: true, status: 'imported', portal: '99acres' });

  // the lead exists, and the log shows it
  const leads = await api<{ items: { name: string; phone: string | null }[] }>(request, acct, 'get', '/leads?q=Amit%20Shah');
  expect(leads.body.items[0]).toMatchObject({ name: 'Amit Shah' });
  await page.reload();
  await expect(page.getByText('Recent parsed emails')).toBeVisible();
  await expect(page.getByText('99acres Buyer Enquiry E2E')).toBeVisible();
  await expect(page.getByText('IMPORTED')).toBeVisible();

  // rotating the URL invalidates the old one
  await page.getByRole('button', { name: 'Rotate URL' }).click();
  await expect(page.getByText('Webhook URL rotated')).toBeVisible();
  await expect.poll(async () => (await gateway.post(`${API}${path}`, { data: { from: 'alerts@99acres.com', subject: 'old key', text: 'Name: Old Key\nPhone: +91 98200 54321' } })).status()).toBe(404);
  await gateway.dispose();
});
