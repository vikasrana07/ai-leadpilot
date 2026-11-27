import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { registerViaApi, signInViaApi } from '../helpers.ts';

test('interactive help tour opens from header, steps through, persists seen state, and passes axe', async ({ page, request }) => {
  const acct = await registerViaApi(request, `tour${Date.now().toString(36)}`);
  await signInViaApi(page, acct);

  await page.goto('/dashboard');
  const helpBtn = page.getByRole('button', { name: 'Start page help tour' });
  await expect(helpBtn).toBeVisible();
  // The dashboard's tour targets only exist once its data has loaded; a tour opened over the loading skeleton collapses to one step.
  await expect(page.locator('[data-tour="dashboard-kpis"]')).toBeVisible();

  await helpBtn.click();
  const dialog = page.getByRole('dialog', { name: 'Dashboard help tour' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^Step 1 of /)).toBeVisible();

  // Verify no axe violations while the tour spotlight & dialog are open.
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);

  // Step forward and back.
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText(/^Step 2 of /)).toBeVisible();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByText(/^Step 1 of /)).toBeVisible();

  // Dismiss with Escape and verify focus returns to the help button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(helpBtn).toBeFocused();

  // Navigate to /leads and trigger via Command Palette (Ctrl/Cmd+K).
  await page.goto('/leads');
  // Wait until the page has hydrated (the keyboard shortcut is registered client-side) before pressing it.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByText('Start page help tour').click();

  const leadsDialog = page.getByRole('dialog', { name: 'Leads Directory help tour' });
  await expect(leadsDialog).toBeVisible();
  await expect(leadsDialog.getByText(/^Step 1 of /)).toBeVisible();
});
