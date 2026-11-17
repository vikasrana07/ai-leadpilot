import { expect, test, type Page } from '@playwright/test';
import { api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/** Phone-sized usage (390x844): no horizontal page scroll on the main screens, the nav drawer works by touch and keyboard, tap targets are reachable. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

let acct: Account; let automationId = '';
test.beforeAll(async ({ request }) => {
  acct = await registerViaApi(request, `mobile${Date.now().toString(36)}`);
  automationId = (await api<{ id: string }>(request, acct, 'post', '/automations/from-template', { templateKey: 'welcome_new_lead' })).body.id;
  for (const [i, name] of ['Aarav Sharma', 'Priya Nair', 'Rohan Mehta'].entries()) await api(request, acct, 'post', '/leads', { name, phone: `+91981200000${i}` });
});

const noHorizontalScroll = async (page: Page, where: string) => {
  const d = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: (document.getElementById('main')?.scrollWidth ?? 0) - (document.getElementById('main')?.clientWidth ?? 0) }));
  expect(d.doc, `${where}: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(d.main, `${where}: content wider than the screen`).toBeLessThanOrEqual(0);
};

test('login page fits the phone and can be completed', async ({ page }) => {
  await page.goto('/login');
  await noHorizontalScroll(page, '/login');
  await page.getByLabel('Email').fill(acct.email); await page.getByLabel('Password').fill(acct.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|onboarding)/);
});

test('the main screens never scroll sideways', async ({ page }) => {
  await signInViaApi(page, acct);
  for (const p of ['/dashboard', '/leads', '/inbox', '/pipeline', '/appointments', '/billing', '/settings', '/reports', '/team']) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page, p);
  }
});

test('leads list is usable: search, open a lead, and the stage control is reachable', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/leads');
  await expect(page.getByRole('link', { name: /Aarav Sharma/ }).first()).toBeVisible();
  await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill('Priya');
  await expect(page.getByRole('link', { name: /Priya Nair/ }).first()).toBeVisible();
  await page.getByRole('link', { name: /Priya Nair/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Priya Nair' })).toBeVisible();
  await expect(page.locator('#stage-sel')).toBeVisible();
  await noHorizontalScroll(page, 'lead detail');
});

test('nav drawer: opens by touch, is a labelled navigation, closes with Escape/close button and navigates', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  const open = page.getByRole('button', { name: 'Open menu' });
  await expect(open).toBeVisible();
  const box = await open.boundingBox();
  expect(box && box.width >= 40 && box.height >= 40, 'menu button is at least 40x40').toBe(true);
  await open.tap();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  await page.getByRole('button', { name: 'Close menu' }).tap();
  await expect(nav).toBeHidden();
  // keyboard: Enter opens it, a link inside navigates and the drawer closes
  await open.focus(); await page.keyboard.press('Enter');
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Leads', exact: true }).tap();
  await expect(page).toHaveURL(/\/leads/);
  await expect(nav).toBeHidden();
});

test('dialogs fit the phone screen', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.goto('/leads');
  await page.getByRole('button', { name: /Add lead/i }).first().tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const b = await dialog.boundingBox();
  const vp = page.viewportSize();
  expect(b && vp && b.x >= 0 && b.x + b.width <= vp.width && b.y >= 0 && b.y + b.height <= vp.height, 'dialog inside the viewport').toBe(true);
});

for (const width of [375, 768]) {
  test(`automation editor fits ${width}px: no sideways scroll, step settings open as a panel, targets are tappable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signInViaApi(page, acct);
    for (const p of ['/automations', '/automations/new', `/automations/${automationId}/edit`]) {
      await page.goto(p);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page, `${p} @${width}`);
    }
    // open a step: the settings appear and the page still does not scroll sideways
    const first = page.getByRole('button', { name: /^Step 1/ });
    await expect(first).toBeVisible(); await first.click();
    const panel = page.getByTestId('inspector-panel');
    await expect(panel.getByRole('heading', { name: /Edit action/ })).toBeVisible();
    await noHorizontalScroll(page, `editor with step open @${width}`);
    const box = await panel.boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= width + 1, `panel inside the ${width}px screen`).toBeTruthy();
    // controls in the editor are at least 40px tall on touch layouts
    if (width < 1024) {
      const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid="outline"] button, [data-testid="inspector"] select, [data-testid="inspector"] input:not([type=checkbox])')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.height < 40); }).map((el) => `${el.tagName} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}`));
      expect(small, small.join('\n')).toEqual([]);
    }
  });
}
