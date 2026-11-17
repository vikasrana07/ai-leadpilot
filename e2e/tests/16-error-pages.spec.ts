import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { registerViaApi, signInViaApi } from '../helpers.ts';

/**
 * Friendly error pages. The error boundary itself (app/error.tsx) cannot be triggered in a production build without a deliberately broken
 * page, so it is covered by the render test in apps/web/components/error-view.test.tsx; here we check the 404 page end to end and that the
 * development-only throwing route is NOT reachable in the production build.
 */
test('unknown page shows the friendly 404 with a way home', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'notfound');
  await signInViaApi(page, acct);
  const res = await page.goto('/this-page-does-not-exist-xyz');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('the development-only error route does not exist in a production build', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'devroute');
  await signInViaApi(page, acct);
  const res = await page.goto('/dev-error');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
  await expect(page.getByText('Deliberate test error')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`404 page: axe 0 violations (${theme}) and fits a 375 px phone`, async ({ page, request }) => {
    const acct = await registerViaApi(request, `nf-axe-${theme}`);
    await signInViaApi(page, acct);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/no-such-page-here');
    await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
