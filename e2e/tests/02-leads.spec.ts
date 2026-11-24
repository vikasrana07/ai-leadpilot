import { expect, test } from '@playwright/test';
import { chooseOption, registerViaApi, selectOptions, signInViaApi } from '../helpers.ts';

// Phase 2 gate: create lead -> move stage.
test('create a lead in the UI, find it in the list, move its stage with the mouse and with the keyboard', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'leads');
  await signInViaApi(page, acct);

  await page.goto('/leads');
  await page.getByRole('button', { name: 'Add lead' }).click();
  await page.getByLabel(/^Name\b/).fill('Rohan Mehta');
  await page.getByLabel(/^Phone\b/).fill('98765 43210');
  await page.getByLabel('Requirements').fill('3 BHK near the metro');
  await page.getByRole('button', { name: 'Add lead' }).last().click();

  await expect(page.getByRole('link', { name: /Rohan Mehta/ }).first()).toBeVisible();
  await page.getByRole('link', { name: /Rohan Mehta/ }).first().click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rohan Mehta' })).toBeVisible();

  const stage = page.locator('#stage-sel');
  const options = await selectOptions(page, stage);
  const current = ((await stage.innerText()) ?? '').trim();
  const targets = options.filter((o) => o !== current);
  expect(targets.length).toBeGreaterThan(1);

  // mouse/select path
  await chooseOption(page, stage, targets[0] as string);
  await expect(page.getByText('Stage updated')).toBeVisible();
  await expect(page.getByText(`Moved from ${current} to ${targets[0]}`)).toBeVisible();

  // keyboard-only path: open the list from the keyboard and TYPE the whole stage name (type-ahead only moves the highlight); Enter commits once.
  const initials = options.map((o) => o[0]?.toLowerCase());
  const next = options.find((o, i) => o !== current && o !== targets[0] && initials.filter((c) => c === initials[i]).length === 1) as string;
  expect(next, 'an open stage with a unique first letter').toBeTruthy();
  await stage.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type(next, { delay: 40 });
  await page.keyboard.press('Enter');
  await expect(stage).toHaveText(next);
  await expect(page.getByText(`Moved from ${targets[0]} to ${next}`)).toHaveCount(1);
  await expect(page.getByText(/^Moved from /)).toHaveCount(2); // exactly two moves in total: no intermediate stages were saved
});
