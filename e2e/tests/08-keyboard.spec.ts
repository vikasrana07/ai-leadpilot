import { expect, test, type Page } from '@playwright/test';
import { registerViaApi, signInViaApi } from '../helpers.ts';

/** Keyboard-only smoke (no axe dependency): the main actions are reachable by Tab and the focused element shows a visible indicator. */
async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== 'none' && cs.boxShadow !== '') || cs.borderColor !== '';
    return { name: el.getAttribute('aria-label') ?? (el.textContent?.trim().slice(0, 40) || el.id || el.tagName), tag: el.tagName, visible, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow };
  });
}

test('login: Tab reaches email, password and Sign in with visible focus', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', /.+/);
  // the email field takes focus on load; Tab then walks password -> forgot-password -> sign in
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('email');
  const seen: string[] = ['email'];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page);
    if (f) { seen.push(f.name); if (f.tag === 'INPUT' || f.tag === 'BUTTON' || f.tag === 'A') expect(f.outline !== 'none 0px' || f.shadow !== 'none', `focus indicator on ${f.name}`).toBe(true); }
  }
  expect(seen.join('|')).toContain('password'); expect(seen.join('|')).toContain('Sign in');
});

test('dashboard: the main navigation and primary action are reachable with the keyboard alone', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'keyboard');
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page);
    if (f) { seen.add(f.name); expect(f.outline !== 'none 0px' || f.shadow !== 'none', `focus indicator on "${f.name}"`).toBe(true); }
  }
  for (const wanted of ['Dashboard', 'Leads', 'Inbox']) expect([...seen].some((s) => s.includes(wanted)), `Tab reaches "${wanted}"`).toBe(true);
  // a link activated with Enter navigates
  await page.getByRole('link', { name: 'Leads', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/leads/);
});
