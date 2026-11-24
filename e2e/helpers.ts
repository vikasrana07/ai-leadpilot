import { createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const API = 'http://localhost:4100';
export const WEB = 'http://localhost:3200';
export const PASSWORD = 'E2e-Passw0rd!x';
/** Unique per run: every email and name carries it, so runs never collide and teardown can find exactly what it created. */
export const RUN = process.env.E2E_RUN ?? `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`; // playwright.config.ts fixes E2E_RUN once so workers and teardown agree

export interface Account { email: string; password: string; name: string; businessName: string; accessToken: string; tenantId: string; userId: string }
export const emailFor = (label: string) => `e2e-${RUN}-${label}@example.test`.toLowerCase();
export const bearer = (a: Account) => ({ Authorization: `Bearer ${a.accessToken}` });

/** Fast path: register a workspace through the API (the UI registration journey has its own test). */
export async function registerViaApi(request: APIRequestContext, label: string, industry = 'real_estate'): Promise<Account> {
  const email = emailFor(label); const name = `E2E ${label}`; const businessName = `E2E Biz ${label} ${RUN}`;
  const res = await request.post(`${API}/auth/register`, { headers: { 'x-token-delivery': 'body' }, data: { name, email, password: PASSWORD, businessName, industry } });
  expect(res.status(), await res.text()).toBe(201);
  const b = await res.json();
  return { email, password: PASSWORD, name, businessName, accessToken: b.accessToken, tenantId: b.activeTenantId, userId: b.user.id };
}

/** Signs the browser in through the API (cookies land in the browser context), then opens a page. Not used by the login journey itself. */
export async function signInViaApi(page: Page, a: Pick<Account, 'email' | 'password'>): Promise<void> {
  const res = await page.context().request.post(`${API}/auth/login`, { headers: { origin: WEB }, data: { email: a.email, password: a.password } });
  expect(res.status(), await res.text()).toBe(200);
}

export async function api<T = unknown>(request: APIRequestContext, a: Account, method: 'get' | 'post' | 'put' | 'patch', path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const res = await request[method](`${API}${path}`, { headers: bearer(a), ...(data === undefined ? {} : { data }) });
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : undefined) as T };
}

export function ownerPool(): pg.Pool {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set (the e2e run needs the .env file)');
  return new pg.Pool({ connectionString: url, max: 2 });
}

/** A platform administrator exists only through the database (the app cannot create one, by design). */
export async function createPlatformAdmin(label: string): Promise<{ email: string; password: string }> {
  const email = emailFor(label); const password = 'E2e-Console-Passw0rd!x';
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const pool = ownerPool();
  try { await pool.query('INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, $3)', [email, hash, 'E2E Admin']); } finally { await pool.end(); }
  return { email, password };
}

/** Signs a WhatsApp webhook body the way Meta does, for the channel's app secret. */
export const waSignature = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export async function loginViaUi(page: Page, a: Pick<Account, 'email' | 'password'>): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(a.email);
  await page.getByLabel('Password').fill(a.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// ---- the app's Select is a custom (Radix) listbox, not a native <select>: open the combobox, then work with role=option.
/** The labels of every option of a select, read by opening it (and closing it again without changing anything). */
export async function selectOptions(page: Page, combobox: Locator): Promise<string[]> {
  await combobox.click();
  const labels = (await page.getByRole('option').allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  return labels;
}
/** Choose an option of a select by its visible label. */
export async function chooseOption(page: Page, combobox: Locator, label: string | RegExp): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { name: label, ...(typeof label === 'string' ? { exact: true } : {}) }).click();
}
