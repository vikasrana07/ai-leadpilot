import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { API, api, ownerPool, registerViaApi, signInViaApi, waSignature, type Account } from '../helpers.ts';

/** WhatsApp Embedded Signup in mock mode (ADR 0012): no Facebook, but the page, the server call and the platform webhook are the real ones. */
const PLATFORM_SECRET = 'e2e-platform-meta-app-secret-0123456789'; // playwright.config.ts sets META_APP_SECRET to the same value for the API

async function openIntegrations(page: Page, acct: Account) {
  await signInViaApi(page, acct);
  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'WhatsApp' }).first()).toBeVisible();
}
async function connectWithMockFacebook(page: Page): Promise<{ phoneNumberId: string; wabaId: string }> {
  await page.getByRole('button', { name: 'Connect WhatsApp' }).click();
  const dialog = page.getByRole('dialog', { name: /Facebook sign-in/ });
  await expect(dialog).toBeVisible();
  const phoneNumberId = await dialog.getByLabel('Phone number ID').inputValue();
  const wabaId = await dialog.getByLabel('WhatsApp Business Account ID').inputValue();
  await dialog.getByRole('button', { name: 'Continue as Facebook user' }).click();
  await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
  return { phoneNumberId, wabaId };
}

test('connect with Facebook (mock): no copy-paste setup, a customer message arrives through the platform webhook, disconnect and reconnect', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'esui');
  await openIntegrations(page, acct);
  await expect(page.getByText('Click Connect WhatsApp, sign in with Facebook')).toBeVisible();
  const { phoneNumberId, wabaId } = await connectWithMockFacebook(page);

  // Facebook-connected: nothing to set up in Meta, and no webhook URL or verify token on screen
  await expect(page.getByText('Connected with Facebook. Messages reach your Inbox automatically')).toBeVisible();
  await expect(page.getByText('Finish setup in Meta')).toHaveCount(0);
  await expect(page.getByText('Callback URL')).toHaveCount(0);
  const channels = await api<{ mode: string; phoneNumberId: string; wabaId: string; webhookUrl: string | null }[]>(request, acct, 'get', '/channels');
  expect(channels.body[0]).toMatchObject({ mode: 'platform', phoneNumberId, wabaId, webhookUrl: null });

  // a customer messages the number: Meta delivers to the ONE platform webhook, signed with the platform secret
  const from = `91981${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: 'Facebook Customer' } }], messages: [{ from, id: `wamid.ES${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Interested in a demo' } }] } }] }] });
  const meta = await pwRequest.newContext(); // Meta calls without cookies or an Origin header
  const post = await meta.post(`${API}/webhooks/whatsapp`, { headers: { 'content-type': 'application/json', 'x-hub-signature-256': waSignature(PLATFORM_SECRET, raw) }, data: raw });
  expect(post.status()).toBe(200); expect((await post.json()).status).toBe('ok');
  await expect.poll(async () => (await api<{ items: { name: string }[] }>(request, acct, 'get', `/leads?q=${from.slice(-10)}`)).body.items?.length ?? 0, { timeout: 15_000 }).toBe(1);
  const forged = await meta.post(`${API}/webhooks/whatsapp`, { headers: { 'content-type': 'application/json', 'x-hub-signature-256': waSignature('not-the-platform-secret', raw) }, data: raw });
  expect(forged.status()).toBe(401);
  await meta.dispose();

  // disconnect, then reconnect with Facebook: the same channel comes back
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByText('Disabled', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect with Facebook' }).click();
  const dialog = page.getByRole('dialog', { name: /Facebook sign-in/ });
  await dialog.getByLabel('Phone number ID').fill(phoneNumberId);
  await dialog.getByLabel('WhatsApp Business Account ID').fill(wabaId);
  await dialog.getByRole('button', { name: 'Continue as Facebook user' }).click();
  await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
  const after = await api<{ id: string }[]>(request, acct, 'get', '/channels');
  expect(after.body).toHaveLength(1);
});

test('the manual "use my own Meta app" path is still offered and still asks for the Meta details', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'esmanual');
  await openIntegrations(page, acct);
  await page.getByRole('button', { name: 'Advanced: use my own Meta app' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect WhatsApp' });
  await expect(dialog).toBeVisible();
  for (const label of ['Phone number ID', 'WhatsApp Business Account ID', 'Permanent access token', 'App secret']) await expect(dialog.getByLabel(label)).toBeVisible();
});

test('a number that another workspace already uses is refused with a plain message', async ({ page, request }) => {
  const a = await registerViaApi(request, 'esdupa');
  const other = await pwRequest.newContext(); const b = await registerViaApi(other, 'esdupb');
  await openIntegrations(page, a);
  const { phoneNumberId, wabaId } = await connectWithMockFacebook(page);
  const taken = await api<{ error: { code: string } }>(other, b, 'post', '/channels/whatsapp/embedded', { name: 'Other', code: 'mock-ok-x', phoneNumberId, wabaId });
  expect(taken.status).toBe(409); expect(taken.body.error.code).toBe('already_connected');
  await other.dispose();
});

test('templates are pulled from WhatsApp with their approval status, and Sync refreshes them', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'estpl');
  await openIntegrations(page, acct);
  await connectWithMockFacebook(page);
  const list = page.getByRole('list').filter({ hasText: 'welcome_message' });
  await expect(list).toContainText('welcome_message'); await expect(list).toContainText('Approved');
  await expect(list).toContainText('offer_update'); await expect(list).toContainText('Pending');
  await page.getByRole('button', { name: 'Sync from WhatsApp' }).click();
  await expect(page.getByText(/Templates synced: 0 added, 2 updated/)).toBeVisible();
});

test('a revoked connection shows "Reconnect needed" with a clear way back, and reconnecting fixes it', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'esrevoked');
  await openIntegrations(page, acct);
  const { phoneNumberId, wabaId } = await connectWithMockFacebook(page);
  const pool = ownerPool();
  try { await pool.query("UPDATE channels SET status = 'NEEDS_RECONNECT' WHERE tenant_id = $1 AND external_id = $2", [acct.tenantId, phoneNumberId]); } finally { await pool.end(); }
  await page.reload();
  await expect(page.getByText('Reconnect needed', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'revoked or has expired' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test connection' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reconnect with Facebook' }).click();
  const dialog = page.getByRole('dialog', { name: /Facebook sign-in/ });
  await dialog.getByLabel('Phone number ID').fill(phoneNumberId); await dialog.getByLabel('WhatsApp Business Account ID').fill(wabaId);
  await dialog.getByRole('button', { name: 'Continue as Facebook user' }).click();
  await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reconnect needed', { exact: true })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`integrations with Facebook-connected WhatsApp and the stand-in dialog: no WCAG A/AA violations (${scheme} theme)`, async ({ browser, request }) => {
    const acct = await registerViaApi(request, `esaxe${scheme}`);
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await openIntegrations(page, acct);
    const run = async () => { await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 }); await page.waitForLoadState('networkidle'); const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); expect(r.violations.map((v) => `${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`)).toEqual([]); };
    await run(); // not connected yet
    await page.getByRole('button', { name: 'Connect WhatsApp' }).click();
    const dialog = page.getByRole('dialog', { name: /Facebook sign-in/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1'); // the fade-in has finished: axe measures colours, and a half-transparent dialog reads as low contrast
    await run(); // stand-in dialog open
    await page.getByRole('dialog').getByRole('button', { name: 'Continue as Facebook user' }).click();
    await expect(page.getByText('Connected with Facebook.')).toBeVisible();
    await run(); // connected
    const pool = ownerPool();
    try { await pool.query("UPDATE channels SET status = 'NEEDS_RECONNECT' WHERE tenant_id = $1", [acct.tenantId]); } finally { await pool.end(); }
    await page.reload(); await expect(page.getByText('Reconnect needed', { exact: true })).toBeVisible();
    await run(); // reconnect needed
    await ctx.close();
  });
}

test('the WhatsApp card fits a 375 px phone without horizontal scrolling, before and after connecting', async ({ browser, request }) => {
  const acct = await registerViaApi(request, 'esmobile');
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await openIntegrations(page, acct);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await connectWithMockFacebook(page);
  await expect(page.getByText('Connected with Facebook.')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await ctx.close();
});

// ---------------------------------------------------------------------------- Meta's data-deletion callback and its public status page
const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
const signedRequest = (userId: string) => { const p = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: Math.floor(Date.now() / 1000) })); return `${b64(createHmac('sha256', PLATFORM_SECRET).update(p).digest())}.${p}`; };

test('a Facebook data-deletion request gets a confirmation code, and its public status page says what LeadPilot holds', async ({ page }) => {
  const meta = await pwRequest.newContext(); // Meta calls without cookies
  const user = String(Math.floor(Math.random() * 9e12) + 1e12);
  const forged = await meta.post(`${API}/webhooks/meta/data-deletion`, { form: { signed_request: 'not.valid' } }); expect(forged.status()).toBe(400);
  const res = await meta.post(`${API}/webhooks/meta/data-deletion`, { form: { signed_request: signedRequest(user) } });
  expect(res.status()).toBe(200);
  const { url, confirmation_code: code } = (await res.json()) as { url: string; confirmation_code: string };
  expect(url).toContain(`/data-deletion?code=${code}`);
  await meta.dispose();

  await page.goto(`/data-deletion?code=${code}`); // no sign-in needed
  await expect(page.getByRole('heading', { level: 1, name: 'Data deletion request' })).toBeVisible();
  await expect(page.getByText('Received', { exact: true })).toBeVisible();
  await expect(page.getByText(/does not store your Facebook profile/)).toBeVisible();
  await expect(page.getByText(code)).toBeVisible();
  await page.goto('/data-deletion?code=' + 'z'.repeat(24));
  await expect(page.locator('#main').getByRole('alert')).toContainText('could not find a request'); // scoped: Next adds its own route announcer with the same role
  await page.goto('/data-deletion');
  await expect(page.locator('#main').getByRole('alert')).toContainText('needs the confirmation code');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the data-deletion status page: no WCAG A/AA violations and fits a phone (${scheme} theme)`, async ({ browser }) => {
    const meta = await pwRequest.newContext();
    const res = await meta.post(`${API}/webhooks/meta/data-deletion`, { form: { signed_request: signedRequest(String(Math.floor(Math.random() * 9e12) + 1e12)) } });
    const code = ((await res.json()) as { confirmation_code: string }).confirmation_code; await meta.dispose();
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 375, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`/data-deletion?code=${code}`);
    await expect(page.getByText('Received', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(overflow).toBeLessThanOrEqual(1);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`)).toEqual([]);
    await ctx.close();
  });
}
