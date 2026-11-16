import { expect, test } from '@playwright/test';
import { registerViaApi, signInViaApi } from '../helpers.ts';

// Phase 2 gate: create lead -> move stage.
test('create a lead in the UI, find it in the list, move its stage with the mouse and with the keyboard', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'leads');
  await signInViaApi(page, acct);

  await page.goto('/leads');
  await page.getByRole('button', { name: 'Add lead' }).click();
  await page.getByLabel('Name').fill('Rohan Mehta');
  await page.getByLabel('Phone').fill('98765 43210');
  await page.getByLabel('Requirements').fill('3 BHK near the metro');
  await page.getByRole('button', { name: 'Add lead' }).last().click();

  await expect(page.getByRole('link', { name: /Rohan Mehta/ }).first()).toBeVisible();
  await page.getByRole('link', { name: /Rohan Mehta/ }).first().click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rohan Mehta' })).toBeVisible();

  const stage = page.locator('#stage-sel');
  const options = await stage.locator('option').allTextContents();
  const current = (await stage.locator('option:checked').textContent()) ?? '';
  const targets = options.filter((o) => o !== current);
  expect(targets.length).toBeGreaterThan(1);

  // mouse/select path
  await stage.selectOption({ label: targets[0] as string });
  await expect(page.getByText('Stage updated')).toBeVisible();
  await expect(page.getByText(`Moved from ${current} to ${targets[0]}`)).toBeVisible();

  // keyboard-only path: focus the select and press the first letter of a stage (type-ahead). One keystroke = one change event, on every OS.
  // (Typing a whole word fires one change per letter, each a separate server move: reported as a product finding.)
  const initials = options.map((o) => o[0]?.toLowerCase());
  const next = options.find((o, i) => o !== current && o !== targets[0] && initials.filter((c) => c === initials[i]).length === 1) as string;
  expect(next, 'an open stage with a unique first letter').toBeTruthy();
  await stage.focus();
  await page.keyboard.press(next[0] as string);
  await expect(stage.locator('option:checked')).toHaveText(next);
  await expect(page.getByText(`Moved from ${targets[0]} to ${next}`)).toHaveCount(1);
});
