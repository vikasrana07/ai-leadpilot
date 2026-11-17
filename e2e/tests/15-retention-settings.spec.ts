import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { registerViaApi, signInViaApi } from '../helpers.ts';

/** Data retention form (Settings): the automation-history fields persist, validate, and are accessible in both themes. */
test('automation retention fields: change, save, reload, persisted; invalid values are refused inline', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'retention-ui');
  await signInViaApi(page, acct);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Automation history' })).toBeVisible();
  await expect(page.getByText('never deleted', { exact: false }).first()).toBeVisible();

  const dry = page.getByLabel('Test runs (days)');
  const runs = page.getByLabel('Finished runs (days)');
  const versions = page.getByLabel('Old automation versions (days)');
  // defaults are shown (7 / 180 / 365 unless the server env overrides them)
  await expect(dry).toHaveValue(/^\d+$/);

  // invalid: inline error, Save stays disabled
  await dry.fill('0');
  await expect(page.getByText(/Enter a whole number of days from \d+ to 3650/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save retention' })).toBeDisabled();
  await dry.fill('abc');
  await expect(page.getByRole('button', { name: 'Save retention' })).toBeDisabled();

  // valid: save, reload, still there
  await dry.fill('14'); await runs.fill('200'); await versions.fill('400');
  await page.getByRole('button', { name: 'Save retention' }).click();
  await expect(page.getByText('Retention saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Test runs (days)')).toHaveValue('14');
  await expect(page.getByLabel('Finished runs (days)')).toHaveValue('200');
  await expect(page.getByLabel('Old automation versions (days)')).toHaveValue('400');

  // a save from the page keeps overrides it does not show: the API still reports them
  const me = await request.get('http://localhost:4100/privacy/retention', { headers: { Authorization: `Bearer ${acct.accessToken}` } });
  expect(me.status()).toBe(200);
  expect((await me.json()).settings).toMatchObject({ automationDryRunDays: 14, automationRunDays: 200, automationVersionDays: 400 });
});

for (const theme of ['light', 'dark'] as const) {
  test(`retention form: axe 0 violations (${theme})`, async ({ page, request }) => {
    const acct = await registerViaApi(request, `retention-axe-${theme}`);
    await signInViaApi(page, acct);
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Automation history' })).toBeVisible();
    await page.getByLabel('Test runs (days)').fill('0'); // also scan the error state
    await expect(page.getByText(/Enter a whole number of days/).first()).toBeVisible();
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
}
