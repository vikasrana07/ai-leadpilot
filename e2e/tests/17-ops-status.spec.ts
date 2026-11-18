import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createPlatformAdmin, ownerPool } from '../helpers.ts';

/** Platform console, Ops status page (monitoring milestone 3): a firing alert is visible, the page is accessible in both themes and fits a phone. */
const KEY = 'outbox_failed';
let admin: { email: string; password: string };

test.beforeAll(async () => {
  admin = await createPlatformAdmin('opsadmin');
  const pool = ownerPool();
  try {
    await pool.query('DELETE FROM ops_alerts WHERE key = $1', [KEY]);
    await pool.query(
      "INSERT INTO ops_alerts (key, severity, status, title, since, notify_count, last_value) VALUES ($1, 3, 'firing', 'Outbox events have failed', now() - interval '12 minutes', 1, '{\"failed\": 3}'::jsonb)",
      [KEY],
    );
  } finally { await pool.end(); }
});
test.afterAll(async () => {
  const pool = ownerPool();
  try { await pool.query('DELETE FROM ops_alerts WHERE key = $1', [KEY]); } finally { await pool.end(); }
});

async function signIn(page: Page) {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

test('ops status: shows the firing alert with severity text, the health table, workers and the service levels', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Ops status' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ops status' })).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: 'Outbox events have failed' }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sev 3');
  await expect(card).toContainText('Firing');
  await expect(card).toContainText('failed: 3');
  await expect(card).toContainText('docs/runbooks/worker-and-queues.md');
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workers and queues' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Service level objectives' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Alert rules and their current state' })).toBeVisible();
  await expect(page.getByText(/Last updated/)).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`ops status: no WCAG A/AA violations (${scheme} theme)`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto('/platform/ops');
    await expect(page.getByRole('heading', { level: 1, name: 'Ops status' })).toBeVisible();
    await expect(page.getByText('Outbox events have failed').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`)).toEqual([]);
    await ctx.close();
  });
}

test('ops status: fits a 375 px phone without horizontal scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto('/platform/ops');
  await expect(page.getByText('Outbox events have failed').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await ctx.close();
});
