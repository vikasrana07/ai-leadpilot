import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { API, api, registerViaApi, signInViaApi } from '../helpers.ts';

// The "customer website" is a real local HTTP server on its own origin. (A page fulfilled through `page.route` is treated by Chrome as a
// non-loopback document and its request to the loopback API is blocked by Local Network Access, which a real website would not hit.)
const SITE_PORT = 3201;
const SITE = `http://localhost:${SITE_PORT}`;

// Phase 3 gate: a website-widget conversation appears in the inbox in real time (SSE), and the owner's reply reaches the widget.
test('widget conversation shows up in the inbox without a reload, and the reply comes back to the visitor', async ({ browser, request }) => {
  const acct = await registerViaApi(request, 'widget');
  const cfg = await api<{ publicKey: string }>(request, acct, 'put', '/widget-config', { allowedOrigins: [SITE], enabled: true, color: '#3f55e8', position: 'right', title: 'Chat with E2E', greeting: 'Welcome to E2E realty' });
  expect(cfg.status).toBe(200);

  // the owner is already looking at the inbox
  const ownerCtx = await browser.newContext(); const owner = await ownerCtx.newPage();
  await signInViaApi(owner, acct);
  await owner.goto('/inbox');
  await expect(owner.getByText('No conversations yet')).toBeVisible();

  // a visitor on a "customer website" served from an allowed origin
  const site = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Customer site</title><h1>Customer site</h1><script src="${API}/widget.js" data-key="${cfg.body.publicKey}" async></script>`); });
  await new Promise<void>((ok) => site.listen(SITE_PORT, ok));
  const visitorCtx = await browser.newContext(); const visitor = await visitorCtx.newPage();
  try {
  await visitor.goto(SITE);
  await visitor.getByRole('button', { name: 'Chat with E2E' }).click();
  await visitor.getByLabel('Your name').fill('Priya Visitor');
  await visitor.getByPlaceholder('Phone number or email').fill('9876500099');
  await visitor.getByRole('button', { name: 'Start chat' }).click();
  await visitor.getByLabel('Type your message').fill('Hello, is the 2 BHK still available?');
  await visitor.getByRole('button', { name: 'Send' }).click();

  // appears in the owner's open inbox without any reload (server-sent events)
  const row = owner.getByRole('button', { name: /Priya Visitor/ }).or(owner.getByText('Priya Visitor')).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(owner.getByText('Hello, is the 2 BHK still available?')).toBeVisible();

  // reply from the inbox reaches the widget
  await owner.getByLabel('Write a reply').fill('Yes, it is. Would you like to visit tomorrow?');
  await owner.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(visitor.getByText('Yes, it is. Would you like to visit tomorrow?')).toBeVisible({ timeout: 20_000 });

  } finally { await ownerCtx.close(); await visitorCtx.close(); await new Promise((ok) => site.close(ok)); }
});
