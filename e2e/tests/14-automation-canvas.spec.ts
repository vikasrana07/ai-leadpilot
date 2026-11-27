import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/**
 * The automation canvas (milestone 3): built with palette buttons and by dragging connections, tidy, undo, keyboard navigation, delete with
 * confirmation, the test overlay and the past-run overlay, the remembered Canvas | Outline choice, the read-only canvas on a phone, no console
 * errors, and axe (light and dark, desktop and phone). Screenshots land in test-results/automation-canvas and are reviewed by a person.
 */
const SHOTS = resolve(import.meta.dirname, '../../test-results/automation-canvas');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
let acct: Account; let leadName = ''; let automationId = '';

test.beforeAll(async ({ request }) => {
  acct = await registerViaApi(request, `canvas${Date.now().toString(36)}`);
  leadName = 'Canvas Test Lead';
  await api(request, acct, 'post', '/leads', { name: leadName, phone: '+919800000666', email: 'canvas@example.test' });
  automationId = (await api<{ id: string }>(request, acct, 'post', '/automations/from-template', { templateKey: 'appointment_reminder_24h' })).body.id;
  mkdirSync(SHOTS, { recursive: true });
});

const watchConsole = (page: Page) => {
  const bad: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  return bad;
};
const nodes = (page: Page) => page.locator('.react-flow__node');
const node = (page: Page, text: RegExp | string) => nodes(page).filter({ hasText: text });
const handle = (n: Locator, id: string) => n.locator(`.react-flow__handle[data-handleid="${id}"]`);
/** The canvas re-fits itself (animated) after a step is added, so wait until the element has stopped moving before using its position. */
async function stableBox(page: Page, l: Locator) {
  let last = await l.boundingBox();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(120);
    const now = await l.boundingBox();
    if (last && now && Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5) return now;
    last = now;
  }
  throw new Error('element never stopped moving');
}
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await stableBox(page, from); const b = await stableBox(page, to);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.waitForTimeout(60);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 }); await page.waitForTimeout(120); await page.mouse.up();
}
/**
 * A drag can miss on a slow machine: the canvas is still settling when the endpoints are measured, or the drop lands before the target handle has
 * registered the hover. Repeat the drag until its visible effect appears. Only for drags that are safe to repeat: a refused connection changes
 * nothing, and re-dropping an existing connection onto the same target is a no-op.
 */
async function dragUntil(page: Page, from: Locator, to: Locator, effect: () => Promise<void>) {
  await expect(async () => { await drag(page, from, to); await effect(); }).toPass({ timeout: 25_000, intervals: [250, 500, 1_000] });
}
const canvasTab = (page: Page) => page.getByTestId('view-canvas');
const toolbar = (page: Page, name: RegExp) => page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button', { name });
async function openCanvas(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  if ((await canvasTab(page).getAttribute('aria-selected')) !== 'true') await canvasTab(page).click();
  await expect(page.getByTestId('canvas-surface')).toBeVisible();
  await expect(nodes(page).first()).toBeVisible();
}

test('build on the canvas with the palette and by dragging, tidy, undo, save, test it and look at a past run', async ({ page }) => {
  const bad = watchConsole(page);
  await signInViaApi(page, acct);
  await page.setViewportSize({ width: 1360, height: 900 });
  await openCanvas(page, '/automations/new');
  await expect(nodes(page)).toHaveCount(2);
  await page.getByTestId('canvas-surface').screenshot({ path: `${SHOTS}/01-blank-light.png` });

  // palette: a condition after the trigger, an action on its open "Otherwise" side, a wait after that
  await nodes(page).filter({ hasText: /Trigger/ }).first().click();
  await toolbar(page, /Add condition/).click();
  await expect(nodes(page)).toHaveCount(3);
  await expect(page.getByTestId('announcer')).toContainText('Added step: If');
  await toolbar(page, /Add action/).click();              // the new condition is selected: its open side is "Otherwise"
  await expect(nodes(page)).toHaveCount(4);
  await toolbar(page, /Add wait/).click();                // the new action is selected: the wait goes after it
  await expect(nodes(page)).toHaveCount(5);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge-text', { hasText: /^Yes$/ })).toHaveCount(1);   // edge labels are words
  await expect(page.locator('.react-flow__edge-text', { hasText: /^No$/ })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Problems to fix/ })).toHaveCount(0);

  // connect by dragging: the wait's "No reply" handle joins the starter action ("New lead")
  const wait = nodes(page).filter({ has: page.getByTestId('flow-wait') });
  const starter = node(page, /New lead/);
  await dragUntil(page, handle(wait, 'next'), handle(starter, 'in'), () => expect(page.locator('.react-flow__edge')).toHaveCount(5, { timeout: 2_500 }));
  await expect(page.getByRole('heading', { name: /Problems to fix/ })).toHaveCount(0);
  await expect(page.getByTestId('announcer')).toContainText('now continues to');

  // a connection that would loop is refused, with the reason on screen, and nothing changes
  const branch = nodes(page).filter({ has: page.getByTestId('flow-branch') });
  await dragUntil(page, handle(starter, 'next'), handle(branch, 'in'), () => expect(page.getByRole('alert').filter({ hasText: /loop/i })).toBeVisible({ timeout: 2_500 }));
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);

  // tidy: every step ends up below the step that leads to it
  await toolbar(page, /Tidy/).click();
  await expect(page.getByTestId('announcer')).toContainText('Arranged the steps');
  const y = async (l: Locator) => ((await l.boundingBox()) as { y: number }).y;
  await expect.poll(async () => (await y(nodes(page).filter({ has: page.getByTestId('flow-trigger') }))) < (await y(branch))).toBe(true);
  await expect.poll(async () => (await y(branch)) < (await y(wait))).toBe(true);
  await page.getByTestId('canvas-surface').screenshot({ path: `${SHOTS}/02-built-tidy-light.png` });

  // undo: add one more, then take it back
  await starter.click();
  await toolbar(page, /Add action/).click();
  await expect(nodes(page)).toHaveCount(6);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(nodes(page)).toHaveCount(5);

  // remove the join again by selecting its connection and pressing Delete (a connection goes at once; undo brings it back)
  const join = page.locator('.react-flow__edge[aria-label^="Connection from Wait"]');
  await expect(join).toHaveCount(1);
  await join.dispatchEvent('click');   // the connection's own click handler (a pixel on a thin curved line behind other steps is not a stable target)
  await expect(join).toHaveClass(/selected/);
  await toolbar(page, /Delete the selected/).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  await expect(page.getByTestId('announcer')).toContainText('now stops');

  // save (keyboard shortcut), turn on
  await page.getByLabel('Name', { exact: true }).fill('Canvas follow-up');
  await page.getByLabel('Name', { exact: true }).press('ControlOrMeta+s');
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByText(/^Version 1\./)).toBeVisible();
  await expect(canvasTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(nodes(page)).toHaveCount(5);
  const id = page.url().match(/automations\/([0-9a-f-]{36})\/edit/)?.[1] as string;

  // test overlay: the lead is not Hot, so it takes Otherwise; the taken path is thick and carries a tick, unreached steps say so
  await page.getByRole('button', { name: /^Test$/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Lead' }).fill('Canvas');
  await dialog.getByRole('button', { name: new RegExp(leadName) }).click();
  await expect(dialog.getByTestId('dry-run-result')).toContainText('Condition not met');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('test-legend')).toBeVisible();
  await expect(page.getByTestId('flow-mark').filter({ hasText: 'Condition not met: takes Otherwise' })).toBeVisible();
  await expect(page.getByTestId('flow-mark').filter({ hasText: 'Not reached' })).toHaveCount(1);          // the If side
  await expect(page.locator('.react-flow__edge-text', { hasText: 'No ✓' })).toHaveCount(1);
  await expect(page.locator('.react-flow__edge-path[style*="stroke-width: 3.5"]')).not.toHaveCount(0);   // the taken path is drawn thick (a straight vertical line has no width, so "visible" is the wrong check)
  await page.getByTestId('canvas-surface').screenshot({ path: `${SHOTS}/03-test-overlay-light.png` });
  await page.getByRole('button', { name: 'Clear test result' }).click();
  await expect(page.getByTestId('flow-mark')).toHaveCount(0);

  // a past run on the canvas: the test above left a run row; open it from run history
  await page.goto('/automations');
  await page.getByRole('tab', { name: 'Run history' }).click().catch(async () => { await page.getByRole('button', { name: 'Run history' }).click(); });
  await page.getByRole('button', { name: /Canvas follow-up/ }).first().click();
  await page.getByRole('link', { name: /on the canvas/ }).first().click();
  await expect(page).toHaveURL(/\?run=/);
  await expect(page.getByTestId('run-banner')).toContainText('Showing a past run');
  await expect(page.getByTestId('flow-mark').filter({ hasText: /Would run|Would wait/ }).first()).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toHaveCount(0);       // a run is read-only
  await page.getByTestId('canvas-surface').screenshot({ path: `${SHOTS}/04-past-run-light.png` });
  await page.getByTestId('run-banner').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('run-banner')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?run=/);

  // the Canvas | Outline choice is remembered, and the Outline shows the same graph
  await page.reload();
  await expect(canvasTab(page)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('view-outline').click();
  await expect(page.getByTestId('outline').locator('button[data-step]')).toHaveCount(5);
  await page.reload();
  await expect(page.getByTestId('view-outline')).toHaveAttribute('aria-selected', 'true');
  expect(id).toBeTruthy();
  expect(bad, bad.join('\n')).toEqual([]);
});

test('keyboard: arrow keys follow the connections, Enter opens the settings, Delete asks first', async ({ page }) => {
  const bad = watchConsole(page);
  await signInViaApi(page, acct);
  await page.setViewportSize({ width: 1360, height: 900 });
  await openCanvas(page, `/automations/${automationId}/edit`);
  const count = await nodes(page).count();
  await nodes(page).first().focus();
  await expect(nodes(page).first()).toBeFocused();
  await expect(nodes(page).first()).toHaveAttribute('aria-label', /^Trigger: /);
  await page.keyboard.press('ArrowDown');
  const second = page.locator('.react-flow__node:focus');
  await expect(second).toHaveAttribute('aria-label', /^Action: /);
  await page.keyboard.press('ArrowUp');
  await expect(nodes(page).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector').getByRole('heading', { name: /Edit action/ })).toBeFocused();
  // Delete on a step asks first; Cancel keeps it, Delete removes it, undo brings it back
  await page.locator('.react-flow__node').filter({ hasText: /Action/ }).first().focus();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: /Delete this step/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(nodes(page)).toHaveCount(count);
  await page.locator('.react-flow__node').filter({ hasText: /Action/ }).first().focus();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: /Delete this step/ }).getByRole('button', { name: 'Delete' }).click();
  await expect(nodes(page)).toHaveCount(count - 1);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(nodes(page)).toHaveCount(count);
  expect(bad, bad.join('\n')).toEqual([]);
});

test('a phone gets the Outline first and a read-only canvas', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const bad = watchConsole(page);
  await signInViaApi(page, acct);
  await page.goto(`/automations/${automationId}/edit`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByTestId('view-outline')).toHaveAttribute('aria-selected', 'true');
  await canvasTab(page).tap();
  await expect(page.getByTestId('canvas-surface')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toHaveCount(0);           // no editing tools
  await expect(page.getByText(/View only here/)).toBeVisible();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await expect(page.locator('.react-flow__handle.lp-readonly').first()).toBeAttached();
  await page.screenshot({ path: `${SHOTS}/05-phone-readonly.png`, fullPage: true });
  await nodes(page).nth(1).tap();                                                             // tapping a step opens its settings sheet
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-phone-inspector.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'no horizontal scroll at 375px').toBeLessThanOrEqual(0);
  expect(bad, bad.join('\n')).toEqual([]);
  await ctx.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: canvas mode has no WCAG A/AA violations (${scheme} theme), desktop and phone`, async ({ browser }) => {
    const found: string[] = [];
    const sweep = async (page: Page, label: string) => {
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      found.push(...r.violations.map((v) => `${label}: ${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`));
    };
    const desktop = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    const d = await desktop.newPage(); await signInViaApi(d, acct);
    for (const p of ['/automations/new', `/automations/${automationId}/edit`]) {
      await openCanvas(d, p); await d.waitForLoadState('networkidle');
      await sweep(d, `${scheme} desktop ${p.replace(automationId, ':id')}`);
    }
    await nodes(d).nth(1).click();                                                          // a step selected, settings open beside the canvas
    await expect(d.getByTestId('inspector')).toBeVisible(); await sweep(d, `${scheme} desktop with settings`);
    if (scheme === 'light') await d.screenshot({ path: `${SHOTS}/07-selected-light.png`, fullPage: true });
    if (scheme === 'dark') await d.screenshot({ path: `${SHOTS}/08-selected-dark.png`, fullPage: true });
    await desktop.close();
    const phone = await browser.newContext({ colorScheme: scheme, viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const m = await phone.newPage(); await signInViaApi(m, acct);
    await m.goto(`/automations/${automationId}/edit`); await expect(m.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await canvasTab(m).tap(); await expect(m.getByTestId('canvas-surface')).toBeVisible(); await m.waitForLoadState('networkidle');
    await sweep(m, `${scheme} phone canvas`);
    await phone.close();
    expect(found, found.join('\n')).toEqual([]);
  });
}
