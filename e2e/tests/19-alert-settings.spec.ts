import { createServer } from 'node:http';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { API, api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/**
 * Sound and desktop alerts. The browser's Notification and AudioContext are replaced by recorders (a real beep or system notification cannot be
 * observed from a test); `document.hasFocus` is overridden to model "the person is in another application". The settings are saved on the account.
 */
const SITE_PORT = 3202;
const SITE = `http://localhost:${SITE_PORT}`;

const STUBS = `
  window.__beeps = 0; window.__notes = []; window.__away = true;
  class Ctx { constructor(){ window.__ctx=(window.__ctx||0)+1; this.state='running'; this.currentTime=0; this.destination={}; }
    resume(){ return Promise.resolve(); }
    createOscillator(){ return { frequency:{ setValueAtTime(){} }, connect(){}, start(){ window.__beeps++; }, stop(){} }; }
    createGain(){ return { gain:{ setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(x){ return x; } }; } }
  window.AudioContext = Ctx; window.webkitAudioContext = Ctx;
  class N { constructor(title, opts){ window.__notes.push({ title, ...opts }); } close(){} static requestPermission(){ N.permission='granted'; return Promise.resolve('granted'); } }
  N.permission = localStorage.getItem('__perm') ?? 'default';
  Object.defineProperty(window, 'Notification', { value: N, configurable: true });
  document.hasFocus = () => !window.__away;
`;
const beeps = (p: Page) => p.evaluate(() => (window as unknown as { __beeps: number }).__beeps);
const notes = (p: Page) => p.evaluate(() => (window as unknown as { __notes: { title: string; tag?: string }[] }).__notes);

let acct: Account; let key = '';
test.beforeAll(async ({ request }) => {
  acct = await registerViaApi(request, `alerts${Date.now().toString(36)}`);
  const cfg = await api<{ publicKey: string }>(request, acct, 'put', '/widget-config', { allowedOrigins: [SITE], enabled: true, color: '#3f55e8', position: 'right', title: 'Chat with E2E', greeting: 'Hi' });
  key = cfg.body.publicKey;
});

async function openOwner(browser: Browser) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.addInitScript(STUBS); await signInViaApi(page, acct); await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /notifications/i }).first()).toBeVisible();
  return { ctx, page };
}
/** The first click on the page lets the browser play sound; wait until the app is listening for it (it is after hydration). */
async function unlock(page: Page) {
  await expect(page.getByRole('button', { name: /^notifications/i }).first()).toBeVisible();
  await expect.poll(async () => { await page.mouse.click(5, 5); return page.evaluate(() => (window as unknown as { __ctx?: number }).__ctx ?? 0); }, { timeout: 10_000 }).toBeGreaterThan(0);
}
async function openSettings(page: Page) {
  await page.getByRole('button', { name: /^notifications/i }).first().click();
  await page.getByRole('button', { name: 'Notification settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Notification settings' })).toBeVisible();
}
/** Reload and wait until the app has its alert settings (a message that arrives before then is, by design, announced quietly), then unlock sound. */
async function reloadReady(page: Page) {
  const loaded = page.waitForResponse((r) => r.url().includes('/me/alert-settings') && r.request().method() === 'GET');
  await page.reload(); await loaded; await unlock(page);
  await page.waitForTimeout(1500);   // let the live connection open
}
let counter = 0;
async function visitorMessages(browser: Browser, name: string) {
  const site = createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Site</title><script src="${API}/widget.js" data-key="${key}" async></script>`); });
  await new Promise<void>((ok) => site.listen(SITE_PORT, ok));
  const ctx = await browser.newContext(); const v = await ctx.newPage();
  try {
    await v.goto(SITE); await v.getByRole('button', { name: 'Chat with E2E' }).click();
    await v.getByLabel('Your name').fill(name); await v.getByPlaceholder('Phone number or email').fill(`98765${String(10000 + ++counter + Math.floor(Math.random() * 80000))}`);
    await v.getByRole('button', { name: 'Start chat' }).click();
    await v.getByLabel('Type your message').fill('Is it available?'); await v.getByRole('button', { name: 'Send' }).click();
    await expect(v.getByText('Is it available?').first()).toBeVisible();
  } finally { await ctx.close(); await new Promise<void>((ok) => site.close(() => ok())); }
}

test('settings are saved on the account, work, and survive a reload and a second browser', async ({ browser, request }) => {
  const { ctx, page } = await openOwner(browser);
  await openSettings(page);
  const dlg = page.getByRole('dialog', { name: 'Notification settings' });
  await expect(dlg.getByLabel('Play a sound for new notifications')).toBeChecked();
  await expect(dlg.getByLabel('Volume')).toHaveValue('50');
  await dlg.getByLabel('Volume').fill('80');
  await dlg.getByRole('button', { name: 'Test sound' }).click();
  expect(await beeps(page)).toBeGreaterThan(0);                       // a beep was played
  await dlg.getByLabel('Play a sound for new notifications').click();   // saved optimistically, so the box changes a moment after the click
  await expect(dlg.getByLabel('Play a sound for new notifications')).not.toBeChecked();
  await expect(dlg.getByLabel('Volume')).toBeDisabled();
  await expect.poll(async () => (await api<{ soundEnabled: boolean; soundVolume: number }>(request, acct, 'get', '/me/alert-settings')).body).toMatchObject({ soundEnabled: false, soundVolume: 80 });
  // axe in the open dialog
  const res = await new AxeBuilder({ page }).include('[role="dialog"]').analyze(); expect(res.violations, JSON.stringify(res.violations.map((v) => v.id))).toEqual([]);
  await page.reload(); await openSettings(page);
  await expect(page.getByRole('dialog').getByLabel('Play a sound for new notifications')).not.toBeChecked();
  await ctx.close();
  // a different browser signed in as the same user sees the same choices
  const { ctx: c2, page: p2 } = await openOwner(browser); await openSettings(p2);
  await expect(p2.getByRole('dialog').getByLabel('Volume')).toHaveValue('80'); await c2.close();
  await api(request, acct, 'put', '/me/alert-settings', { soundEnabled: true, soundVolume: 50, desktopEnabled: true });
});

test('a new chat while the person is in another application gives one beep and one desktop alert; each switch silences its own', async ({ browser, request }) => {
  await api(request, acct, 'put', '/me/alert-settings', { soundEnabled: true, soundVolume: 60, desktopEnabled: true });
  const { ctx, page } = await openOwner(browser);
  await page.evaluate(() => localStorage.setItem('__perm', 'granted'));
  await reloadReady(page);                                       // the click that lets the browser play sound
  await visitorMessages(browser, 'Riya Away');
  await expect.poll(() => notes(page), { timeout: 20_000 }).toHaveLength(1);
  const [n] = await notes(page); expect(n?.title).toMatch(/Riya Away/); expect(n?.tag).toBeTruthy();
  expect(await beeps(page)).toBeGreaterThanOrEqual(1);

  // sound off, desktop on: a desktop alert but no new beep
  await api(request, acct, 'put', '/me/alert-settings', { soundEnabled: false, soundVolume: 60, desktopEnabled: true });
  await reloadReady(page);
  const before = await beeps(page);
  await visitorMessages(browser, 'Sam Quiet');
  await expect.poll(async () => (await notes(page)).length, { timeout: 20_000 }).toBe(1);
  expect(await beeps(page)).toBe(before);

  // desktop off, sound on: a beep but no alert
  await api(request, acct, 'put', '/me/alert-settings', { soundEnabled: true, soundVolume: 60, desktopEnabled: false });
  await reloadReady(page);
  await visitorMessages(browser, 'Tia Beep');
  await expect.poll(() => beeps(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  expect(await notes(page)).toHaveLength(0);
  await ctx.close();
});

test('no desktop alert while the person is looking at LeadPilot', async ({ browser, request }) => {
  await api(request, acct, 'put', '/me/alert-settings', { soundEnabled: true, soundVolume: 60, desktopEnabled: true });
  const { ctx, page } = await openOwner(browser);
  await page.evaluate(() => { localStorage.setItem('__perm', 'granted'); (window as unknown as { __away: boolean }).__away = false; });
  await page.reload(); await page.evaluate(() => { (window as unknown as { __away: boolean }).__away = false; });
  await visitorMessages(browser, 'Uma Here');
  await expect(page.getByText(/Uma Here/).first()).toBeVisible({ timeout: 20_000 });  // the pop-up or the bell shows it
  expect(await notes(page)).toHaveLength(0);
  await ctx.close();
});
