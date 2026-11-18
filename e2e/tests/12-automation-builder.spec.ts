import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/**
 * The automation builder (Outline editor): built with the KEYBOARD only (menus and buttons are operated with Enter and arrow keys; text
 * is typed), saved, turned on, tested against a real lead with the unsaved draft, edited again, the unsaved-changes guard, the stale-save
 * (409) message, and no console errors (which is also where a CSP violation would show up). Screenshots land in test-results/automation-builder.
 */
const SHOTS = resolve(import.meta.dirname, '../../test-results/automation-builder');
let acct: Account; let leadName = '';
test.beforeAll(async ({ request }) => {
  acct = await registerViaApi(request, `builder${Date.now().toString(36)}`);
  leadName = 'Builder Test Lead';
  await api(request, acct, 'post', '/leads', { name: leadName, phone: '+919800000555', email: 'builder@example.test' });
  mkdirSync(SHOTS, { recursive: true });
});

const watchConsole = (page: Page) => {
  const bad: string[] = [];
  // A 409 is the stale-save case this spec provokes on purpose; the browser logs every non-2xx response as a console error.
  // Failed requests are reported with their URL (a bare "Failed to load resource" says nothing); the console filter covers everything else.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 409) bad.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  return bad;
};
/** Open a step's ⋯ menu with the keyboard and choose an item by name. */
async function menu(page: Page, button: RegExp, item: RegExp) {
  const b = page.getByRole('button', { name: button }); await b.focus(); await page.keyboard.press('Enter');
  const it = page.getByRole('menuitem', { name: item }); await expect(it).toBeVisible();
  // navigate to it with the arrow keys, as a keyboard user would
  for (let i = 0; i < 8 && !(await it.evaluate((el) => el === document.activeElement || el.hasAttribute('data-highlighted'))); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
/** A step's own button (not the add-step buttons whose labels mention the same title). */
const step = (page: Page, text: RegExp | string) => page.getByTestId('outline').locator('button[data-step]').filter({ hasText: text });
const press = async (page: Page, name: RegExp | string) => { const b = page.getByRole('button', { name }); await b.focus(); await page.keyboard.press('Enter'); };

test('build a branching automation with the keyboard, save, turn on, test it, edit it, and hit a stale save', async ({ page }) => {
  const bad = watchConsole(page);
  await signInViaApi(page, acct);
  await page.goto('/automations');
  await expect(page.getByRole('heading', { level: 1, name: 'Automations' })).toBeVisible();
  await page.getByRole('link', { name: 'New automation' }).focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/automations\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'New automation' })).toBeVisible();
  const outline = page.getByTestId('outline');
  await expect(outline.getByRole('button', { name: /^Trigger/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-new-blank.png`, fullPage: true });

  // trigger -> [condition: temperature is Hot] ; yes: (the starter alert) ; no: a new action
  await menu(page, /Actions for the trigger/, /Add a condition/);
  await expect(step(page, /Step 1 · If \/ otherwise/)).toBeFocused();                                   // focus moves to the new step
  await expect(page.getByTestId('announcer')).toContainText('Added step: If');
  await expect(page.getByTestId('inspector').getByRole('heading', { name: /Edit condition/ })).toBeVisible();
  await press(page, /Add action to the "Otherwise" path/);
  await expect(step(page, /Follow up with/)).toBeVisible();
  // on the Hot path: wait a day, then an action
  await press(page, /Add wait after: Notify managers/);
  await expect(step(page, /Wait 1 day/)).toBeFocused();
  await press(page, /Add action after: Wait 1 day/);
  await expect(page.getByRole('heading', { name: 'Problems to fix' })).toHaveCount(0);

  // open the Otherwise action with Enter: focus goes to its settings; edit the title (applies as soon as it is valid)
  const otherwise = outline.getByRole('list', { name: 'Steps for: Otherwise' }).locator('button[data-step]').first();
  await otherwise.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector').getByRole('heading', { name: /Edit action/ })).toBeFocused();
  await page.getByLabel('Alert title').fill('Nurture {{lead.firstName}}');
  await expect(step(page, /Nurture \{\{lead\.firstName\}\}/)).toBeVisible();
  // an invalid value is not applied, and says so
  await page.getByLabel('Alert title').fill('');
  await expect(page.getByTestId('inspector').getByText('These changes are not applied yet')).toBeVisible();
  await page.getByLabel('Alert title').fill('Nurture {{lead.firstName}}');
  await expect(page.getByTestId('inspector').getByText('These changes are not applied yet')).toHaveCount(0);

  await expect(page.getByTestId('summary')).toContainText('If temperature is HOT', { timeout: 5000 });
  await expect(page.getByTestId('summary')).toContainText('wait 1 day');
  await expect(page.getByTestId('summary')).toContainText('Otherwise');
  await page.getByLabel('Name', { exact: true }).fill('Hot lead follow-up');
  await page.screenshot({ path: `${SHOTS}/02-built-desktop.png`, fullPage: true });

  // save with the keyboard shortcut
  await page.getByLabel('Name', { exact: true }).press('ControlOrMeta+s');
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}\/edit$/);
  const id = page.url().match(/automations\/([0-9a-f-]{36})\/edit/)?.[1] as string;
  await expect(page.getByText(/^Version 1\./)).toBeVisible();

  // turn it on
  await press(page, 'Turn on');
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();

  // test it against the lead using the DRAFT (unsaved edit below): temperature is not Hot, so it takes Otherwise
  await page.getByLabel('Name', { exact: true }).fill('Hot lead follow-up (draft)');
  await press(page, /^Test$/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Lead' }).fill('Builder');
  await dialog.getByRole('button', { name: new RegExp(leadName) }).click();
  const result = dialog.getByTestId('dry-run-result');
  await expect(result).toContainText('Condition not met');
  await expect(result).toContainText('Would run');
  await page.screenshot({ path: `${SHOTS}/03-test-result.png` });
  await page.keyboard.press('Escape');
  await expect(outline.getByTestId('overlay').first()).toBeVisible();
  await expect(outline.getByText('Test: condition not met, takes Otherwise')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-overlay.png`, fullPage: true });
  await page.getByRole('button', { name: 'Clear test result' }).click();
  await expect(outline.getByTestId('overlay')).toHaveCount(0);

  // edit and save again: the version goes up
  await page.getByLabel('Name', { exact: true }).fill('Hot lead follow-up');
  await step(page, /Wait 1 day/).click();
  await page.getByTestId('inspector').getByLabel('Wait for').fill('2');
  await expect(step(page, /Wait 2 days/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Version 2\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();   // still on: edits apply to new events

  // the unsaved-changes guard: a link click asks first
  await page.getByLabel('Name', { exact: true }).fill('Renamed but not saved');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Automations' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`/automations/${id}/edit$`));
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Renamed but not saved');

  // a stale save: someone else saves a newer version first (through the API), then we save from an older one
  const cur = await api<{ graph: unknown; version: number; cooldownMinutes: number }>(page.context().request, acct, 'get', `/automations/${id}`);
  const g = cur.body.graph as { nodes: { id: string; type: string; data: { minutes?: number } }[] };
  const w = g.nodes.find((n) => n.type === 'wait'); if (w) w.data.minutes = 180;
  const put = await api(page.context().request, acct, 'put', `/automations/${id}`, { name: 'Edited elsewhere', graph: cur.body.graph, cooldownMinutes: cur.body.cooldownMinutes, expectedVersion: cur.body.version });
  expect(put.status).toBe(200);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const conflict = page.getByTestId('conflict');
  await expect(conflict).toContainText('Someone else saved a newer version');
  await page.screenshot({ path: `${SHOTS}/05-conflict.png` });
  await conflict.getByRole('button', { name: 'Reload the latest version' }).click();
  await expect(page.getByText(/^Version 3\./)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Edited elsewhere');
  await expect(step(page, /Wait 3 hours/)).toBeVisible();

  // it behaves as saved: the list shows it, on, with branches
  await page.goto('/automations');
  await expect(page.getByText('Edited elsewhere')).toBeVisible();
  await expect(page.getByText('Branches or waits').first()).toBeVisible();
  expect(bad, bad.join('\n')).toEqual([]);
});

test('invalid automations are explained in place and cannot be saved; loops are refused; paths can be joined', async ({ page }) => {
  const bad = watchConsole(page);
  await signInViaApi(page, acct);
  await page.goto('/automations/new');
  const outline = page.getByTestId('outline');
  await page.getByLabel('Name', { exact: true }).fill('Join paths');
  // add a condition, so there are two paths, then join "Otherwise" to the existing action instead of a new step
  await menu(page, /Actions for the trigger/, /Add a condition/);
  const select = page.getByTestId('inspector').getByLabel('Otherwise', { exact: true });
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  expect(options.some((o) => /Notify managers/.test(o))).toBe(true);
  await select.selectOption({ label: options.find((o) => /Notify managers/.test(o)) as string });
  await expect(outline.getByText(/Continues with the step/)).toBeVisible();   // both paths now meet at one step
  await expect(page.getByTestId('summary')).toContainText('Otherwise');
  // a loop is not even offered: the action cannot point back at the condition
  await step(page, /^Step 2 · Action/).click();
  const next = page.getByTestId('inspector').getByLabel('Next', { exact: true });
  const nextOptions = await next.locator('option').allTextContents();
  expect(nextOptions.some((o) => /^If /.test(o))).toBe(false);
  // an empty required value shows a problem and blocks saving
  await page.getByTestId('inspector').getByLabel('What should happen?').selectOption('change_stage');
  await expect(page.getByTestId('inspector').getByText('These changes are not applied yet')).toBeVisible();
  // delete the only action on a path: the other still stands, and undo brings it back
  await page.getByRole('button', { name: /Actions for step 2/ }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Delete step' }).click();
  await expect(page.getByTestId('announcer')).toContainText('Deleted step');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect(step(page, /Step 2 · Action/)).toBeVisible();
  expect(bad, bad.join('\n')).toEqual([]);
});

test('screenshots: phone width with step settings open, and dark theme', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, colorScheme: 'dark', hasTouch: true });
  const page = await ctx.newPage();
  await signInViaApi(page, acct);
  await page.goto('/automations/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New automation' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-phone-dark-new.png`, fullPage: false });
  await page.getByRole('button', { name: /^Step 1/ }).click();
  await expect(page.getByTestId('inspector-panel').getByRole('heading', { name: /Edit action/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-phone-dark-settings.png`, fullPage: false });
  await ctx.close();
});

/**
 * Regression for an intermittent keyboard-focus loss. "Add action" asks for focus on the new step and re-checks it ~260 ms later (a menu that
 * just closed may hand focus back to its trigger). If the user opens another step with Enter in between, focus moves to that step's settings;
 * the old re-check then pulled focus back to the new step. It only showed on a slow page, so this test controls the page's timers
 * (page.clock) and fires the stale timer at the worst moment, every time.
 */
test('a late "focus the new step" request never steals focus from the settings the user just opened', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.clock.install();
  await page.goto('/automations/new');
  const outline = page.getByTestId('outline');
  await expect(outline.getByRole('button', { name: /^Trigger/ })).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));          // from here no page timer fires unless the test advances the clock

  // 1) add an action: the editor schedules "focus the new step now" and "check again in 260 ms"
  const add = outline.getByRole('button', { name: /^Add action after/ }).last();
  await add.focus(); await page.keyboard.press('Enter');
  await expect(outline.locator('button[data-step]')).toHaveCount(3);
  // 2) before any timer fires, open the first action with Enter: its settings should get focus
  const first = outline.locator('button[data-step]').nth(1);
  await first.focus(); await page.keyboard.press('Enter');
  // 3) let the page's timers run: first the "now" attempt and the next animation frame, then the stale 260 ms re-check
  await page.clock.runFor(20);
  await page.clock.runFor(400);
  await expect(page.getByTestId('inspector').getByRole('heading', { name: /Edit action/ })).toBeFocused();
});

/** Same family: the FIRST attempt of an "Add" request must not take focus if the user already focused another control (Enter would then press the wrong button). */
test('the first "focus the new step" attempt does not take focus from a control the user already moved to', async ({ page }) => {
  await signInViaApi(page, acct);
  await page.clock.install();
  await page.goto('/automations/new');
  const outline = page.getByTestId('outline');
  await expect(outline.getByRole('button', { name: /^Trigger/ })).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));

  const addAction = outline.getByRole('button', { name: /^Add action after/ }).last();
  await addAction.focus(); await page.keyboard.press('Enter');         // the request is now pending (its timers have not fired)
  await expect(outline.locator('button[data-step]')).toHaveCount(3);
  const addWait = outline.getByRole('button', { name: /^Add wait after/ }).last();
  await addWait.focus();                                                // the user moves on to the next control right away
  await page.clock.runFor(20);
  await page.clock.runFor(400);
  await expect(addWait).toBeFocused();                                  // the stale request must not have taken focus
});
