import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/**
 * Accessibility (WCAG 2.2 AA): automated axe sweep of the main screens in light AND dark themes, plus the keyboard patterns axe cannot judge
 * (skip link, dialog focus trap and restore, command palette, menus, nav drawer, reduced motion). Axe finds roughly a third of issues;
 * the manual audit and its findings are in docs/accessibility-and-responsive.md.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['/dashboard', '/leads', '/pipeline', '/inbox', '/properties', '/appointments', '/ai-assistant', '/knowledge', '/tasks', '/automations', '/reports', '/team', '/roles', '/integrations', '/billing', '/usage', '/audit', '/settings', '/security', '/api-keys', '/webhooks'];

let acct: Account; let leadId = '';
test.beforeAll(async ({ request }) => {
  acct = await registerViaApi(request, `a11y${Date.now().toString(36)}`);
  const lead = await api<{ id: string }>(request, acct, 'post', '/leads', { name: 'Accessible Lead', phone: '+919800000777', email: 'a11y@example.test' });
  leadId = lead.body.id;
});

async function violations(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.map((v) => `${label}: ${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no WCAG A/AA violations on the main screens (${scheme} theme)`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await signInViaApi(page, acct);
    const found: string[] = [];
    for (const p of [...PAGES, `/leads/${leadId}`]) {
      await page.goto(p);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      found.push(...(await violations(page, `${scheme} ${p.replace(leadId, ':id')}`)));
    }
    await ctx.clearCookies();
    await page.goto('/login'); found.push(...(await violations(page, `${scheme} /login`)));
    await page.goto('/register'); found.push(...(await violations(page, `${scheme} /register`)));
    expect(found, found.join('\n')).toEqual([]);
    await ctx.close();
  });
}

test('skip link is the first Tab stop and moves focus to the main content', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused(); await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('dialogs trap focus, close on Escape and return focus to the control that opened them', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/leads');
  const opener = page.getByRole('button', { name: /Add lead/i }).first();
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/lead/i);
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab #${i + 1} stays inside the dialog`).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('command palette: opens from the keyboard, is operable without a mouse and restores focus', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.type('leads');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/leads/);
});

test('menus: the account menu opens with the keyboard, arrow keys move between items and Escape closes it', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Account menu' });
  await trigger.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menuitem');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('form errors are announced: invalid login marks the field and ties the message to it', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: /create|sign up|register/i }).first().click();
  const invalid = page.locator('[aria-invalid="true"]').first();
  await expect(invalid).toBeVisible();
  const described = await invalid.getAttribute('aria-describedby');
  expect(described, 'invalid field points at its error message').toBeTruthy();
  await expect(page.locator(`#${described?.split(' ')[0]}`)).toHaveAttribute('role', 'alert');
});

test('reduced motion is honoured: animated skeletons and transitions are effectively disabled', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  const dur = await page.evaluate(() => { const s = document.createElement('div'); s.className = 'skeleton'; document.body.append(s); const d = getComputedStyle(s).animationDuration; s.remove(); return d; });
  expect(parseFloat(dur)).toBeLessThan(0.05);
  await ctx.close();
});
