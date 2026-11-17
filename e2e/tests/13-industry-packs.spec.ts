import { expect, test, type Page } from '@playwright/test';
import { api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/**
 * Industry packs (ADR-0011): each industry gets its own pipeline, lead form, appointment wording and automation templates, and the
 * menu only shows modules the industry uses. Real estate is the control: it must look exactly as before.
 */
const INDUSTRIES = [
  {
    id: 'coaching', label: 'coaching', stages: ['Enquiry', 'Demo class booked', 'Demo class attended', 'Enrolled', 'Dropped'],
    interest: 'Course or exam', customField: 'Who is enquiring', visit: 'demo class', template: 'Remind students the day before the demo class',
    absent: ['Budget min (₹)', 'Property type', 'Buying timeline'],
  },
  {
    id: 'healthcare', label: 'clinic', stages: ['Enquiry', 'Appointment booked', 'Visited', 'Treatment started', 'Lost'],
    interest: 'Service interested in', customField: 'Preferred doctor', visit: 'consultation', template: 'Remind patients the day before the consultation',
    absent: ['Budget min (₹)', 'Property type', 'Buying timeline'],
  },
  {
    id: 'home_services', label: 'home', stages: ['Enquiry', 'Quote sent', 'Site inspection', 'Booked', 'Lost'],
    interest: 'Service needed', customField: 'How soon is it needed', visit: 'inspection', template: 'Follow up two days after sending a quote',
    absent: ['Buying timeline'], // (its own custom field is also called "Property type", so only the core field names are checked)
  },
] as const;

async function chooseIndustry(request: Parameters<typeof api>[0], a: Account) {
  const r = await api(request, a, 'put', '/tenant/onboarding', { step: 'team', completed: ['business', 'industry'], skipped: [] });
  expect(r.status).toBe(200);
}
const sidebarLink = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true });

for (const ind of INDUSTRIES) {
  test(`${ind.id}: its own pipeline, lead form, appointment wording and templates; no Properties in the menu`, async ({ page, request }) => {
    const acct = await registerViaApi(request, `pack-${ind.label}`, ind.id);
    await chooseIndustry(request, acct);
    await signInViaApi(page, acct);

    // menu: real-estate-only module hidden, everything else present
    await page.goto('/dashboard');
    await expect(sidebarLink(page, 'Leads')).toBeVisible();
    await expect(sidebarLink(page, 'Properties')).toHaveCount(0);

    // lead form uses the pack's labels, hides real-estate fields, and shows the pack's custom fields
    await page.goto('/leads');
    await page.getByRole('button', { name: 'Add lead' }).click();
    await expect(page.getByLabel(ind.interest)).toBeVisible();
    await expect(page.getByLabel(ind.customField)).toBeVisible();
    for (const hidden of ind.absent) await expect(page.getByLabel(hidden)).toHaveCount(0);
    await page.getByLabel('Name').fill(`Pack ${ind.label} Lead`);
    await page.getByLabel('Phone').fill('98765 43211');
    await page.getByLabel(ind.interest).fill('Starter interest');
    await page.getByRole('button', { name: 'Add lead' }).last().click();
    await expect(page.getByRole('link', { name: new RegExp(`Pack ${ind.label} Lead`) }).first()).toBeVisible();

    // the lead detail card says the pack's words, not "Property" / "Buying timeline"
    await page.getByRole('link', { name: new RegExp(`Pack ${ind.label} Lead`) }).first().click();
    await expect(page.getByText(ind.interest, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Property', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Buying timeline', { exact: true })).toHaveCount(0);

    // pipeline columns are the pack's stages
    await page.goto('/pipeline');
    for (const s of ind.stages) await expect(page.getByText(s, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Site Visit Scheduled')).toHaveCount(0);

    // appointments speak the pack's noun
    await page.goto('/appointments');
    await expect(page.getByRole('button', { name: new RegExp(`Book ${ind.visit}`, 'i') }).first()).toBeVisible();

    // automation gallery offers this industry's starter and not another industry's
    await page.goto('/automations');
    await page.getByRole('tab', { name: 'Templates' }).click();
    await expect(page.getByText(ind.template)).toBeVisible();
    for (const other of INDUSTRIES) if (other.id !== ind.id) await expect(page.getByText(other.template)).toHaveCount(0);
  });
}

test('real estate (control): Properties, the property fields and site-visit wording are still there', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'pack-re', 'real_estate');
  await chooseIndustry(request, acct);
  await signInViaApi(page, acct);
  await page.goto('/dashboard');
  await expect(sidebarLink(page, 'Properties')).toBeVisible();
  await page.goto('/leads');
  await page.getByRole('button', { name: 'Add lead' }).click();
  for (const shown of ['Budget min (₹)', 'Property type', 'Buying timeline', 'Preferred location']) await expect(page.getByLabel(shown)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/appointments');
  await expect(page.getByRole('button', { name: /Book site visit/i }).first()).toBeVisible();
  await page.goto('/pipeline');
  await expect(page.getByText('Site Visit Scheduled', { exact: true }).first()).toBeVisible();
});

test('onboarding: before an industry is chosen Properties is hidden; choosing Coaching re-seeds the pipeline in the UI', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'pack-onboard', 'real_estate'); // signup default; nothing chosen yet
  await signInViaApi(page, acct);

  await page.goto('/dashboard');
  await expect(sidebarLink(page, 'Leads')).toBeVisible();
  await expect(sidebarLink(page, 'Properties')).toHaveCount(0); // not chosen yet: do not assume real estate

  await page.goto('/onboarding');
  const saved = (method: string, path: string) => page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path && r.ok());
  await Promise.all([saved('PUT', '/tenant/onboarding'), page.getByRole('button', { name: /Save and continue/ }).click()]); // business step
  await page.getByRole('radio', { name: 'Coaching & education' }).click();
  await expect(page.getByText(/each get their own pipeline stages/)).toBeVisible();
  await Promise.all([saved('PATCH', '/tenant'), saved('PUT', '/tenant/onboarding'), page.getByRole('button', { name: /Save and continue/ }).click()]);

  await page.goto('/pipeline');
  await expect(page.getByText('Demo class booked', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Site Visit Scheduled')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(sidebarLink(page, 'Properties')).toHaveCount(0);
});
