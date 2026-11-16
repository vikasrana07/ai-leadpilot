import { expect, test } from '@playwright/test';
import { emailFor, loginViaUi, PASSWORD, RUN } from '../helpers.ts';

test('register through the UI, sign out, sign in again', async ({ page }) => {
  const email = emailFor('ui-register');
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Asha Verma');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Business name').fill(`E2E Skyline ${RUN}`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: /Welcome, Asha/ })).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  // the session is really gone: a protected page bounces back to the login screen
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);

  await loginViaUi(page, { email, password: PASSWORD });
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: /Welcome, Asha/ })).toBeVisible();
});

test('a wrong password is refused without revealing which part was wrong', async ({ page }) => {
  await loginViaUi(page, { email: emailFor('nobody'), password: 'Wrong-Passw0rd!x' });
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
