import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, registerViaApi, signInViaApi, type Account } from '../helpers.ts';

/** WhatsApp consent ledger: the lead page shows who agreed, how and when; an opt-out is final; CSV consent needs an attestation. */

const leadOf = async (request: Parameters<typeof api>[0], acct: Account, name: string, phone: string) => {
  const r = await api<{ id: string }>(request, acct, 'post', '/leads', { name, phone });
  expect(r.status).toBe(201);
  return r.body.id;
};

test('consent card: record an attested opt-in, then an opt-out that cannot be undone from the UI', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'consent');
  await signInViaApi(page, acct);
  const id = await leadOf(request, acct, 'Meera Kapoor', '+919811200001');

  await page.goto(`/leads/${id}`);
  const card = page.locator('[data-tour="lead-detail-consent"]');
  await expect(card.getByRole('heading', { name: 'WhatsApp consent' })).toBeVisible();
  await expect(card.getByText('Not recorded')).toHaveCount(2); // replies and marketing
  await expect(card.getByText('No consent has been recorded for this person yet.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Record opt-out' })).toBeVisible();

  // opt-in needs an explicit attestation
  await card.getByRole('button', { name: 'Record opt-in' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record a marketing opt-in' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Record opt-in' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/I confirm this person agreed/).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('Opt-in recorded')).toBeVisible();

  // the ledger now says who, how and when
  const history = card.getByRole('list', { name: 'Consent history' });
  await expect(history.getByText('Opted in · Marketing')).toBeVisible();
  await expect(history.getByText(/Recorded by a team member · E2E consent/)).toBeVisible();
  await expect(card.getByText('Allowed', { exact: true })).toHaveCount(2);
  await expect(card.getByRole('button', { name: 'Record opt-in' })).toHaveCount(0); // already opted in

  const axe = await new AxeBuilder({ page }).include('[data-tour="lead-detail-consent"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);

  // an opt-out needs a reason
  await card.getByRole('button', { name: 'Record opt-out' }).click();
  const out = page.getByRole('dialog', { name: 'Record an opt-out' });
  const record = out.getByRole('button', { name: 'Record opt-out' });
  await expect(record).toBeDisabled();
  await out.getByLabel('Why? (required)').fill('Asked on the phone to stop messages');
  await expect(record).toBeEnabled();
  await record.click();
  await expect(page.getByText('Opt-out recorded')).toBeVisible();

  await expect(card.getByText('Opted out', { exact: true })).toHaveCount(2); // the two state badges
  await expect(history.getByText('Opted out · Marketing')).toBeVisible();
  await expect(history.getByText(/“Asked on the phone to stop messages”/)).toBeVisible();
  await expect(card.getByText(/Only they can opt back in, by sending START on WhatsApp/)).toBeVisible();
  // and the UI offers no way to undo it
  await expect(card.getByRole('button', { name: 'Record opt-in' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Record opt-out' })).toHaveCount(0);

  // the server agrees, and the lead timeline shows the changes
  const view = await api<{ whatsapp: { service: string; marketing: string }; history: { status: string }[] }>(request, acct, 'get', `/leads/${id}/consents`);
  expect(view.body.whatsapp).toEqual({ service: 'OPTED_OUT', marketing: 'OPTED_OUT' });
  expect(view.body.history.map((h) => h.status)).toEqual(['OPTED_OUT', 'OPTED_IN']);
});

test('CSV import: consent marks are only honoured after the importer attests they hold proof', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'consentcsv');
  await signInViaApi(page, acct);

  await page.goto('/leads');
  await page.getByRole('button', { name: /Import/ }).first().click();
  const dialog = page.getByRole('dialog');
  const csv = 'name,phone,whatsapp_consent\nCsv Agreed,+919811200011,yes\nCsv Silent,+919811200012,\n';
  await dialog.locator('#csv-file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  await expect(dialog.getByText(/2 of 2 rows will be imported/)).toBeVisible();
  const attest = dialog.getByLabel(/I confirm these people agreed to receive WhatsApp marketing messages/);
  await expect(attest).toBeVisible();
  await expect(dialog.getByText(/rows are marked/)).toContainText('1');
  await attest.check();
  await dialog.getByRole('button', { name: /^Import/ }).click();

  await expect(page.getByText('Imported 2 rows · 1 WhatsApp opt-in recorded')).toBeVisible();
  await expect(dialog).toBeHidden();

  // the marked lead is eligible for marketing, the unmarked one is not, and the proof names the import
  const find = async (q: string) => (await api<{ items: { id: string }[] }>(request, acct, 'get', `/leads?q=${encodeURIComponent(q)}`)).body.items[0]!.id;
  const agreed = await api<{ whatsapp: { marketing: string }; history: { method: string; actor: string }[] }>(request, acct, 'get', `/leads/${await find('Csv Agreed')}/consents`);
  expect(agreed.body.whatsapp.marketing).toBe('ELIGIBLE');
  expect(agreed.body.history[0]).toMatchObject({ method: 'CSV_IMPORT', actor: 'E2E consentcsv' });
  const silent = await api<{ whatsapp: { marketing: string } }>(request, acct, 'get', `/leads/${await find('Csv Silent')}/consents`);
  expect(silent.body.whatsapp.marketing).toBe('NO_CONSENT');
});

test('CSV import: without the attestation the consent marks are ignored', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'consentcsv2');
  await signInViaApi(page, acct);

  await page.goto('/leads');
  await page.getByRole('button', { name: /Import/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#csv-file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from('name,phone,whatsapp_consent\nCsv Unattested,+919811200021,yes\n') });
  await expect(dialog.getByLabel(/I confirm these people agreed/)).toBeVisible();
  await dialog.getByRole('button', { name: /^Import/ }).click(); // attestation left unticked
  await expect(page.getByText('Imported 1 row', { exact: true })).toBeVisible(); // no "opt-in recorded" suffix: the marks were ignored
  await expect(dialog).toBeHidden();

  const id = (await api<{ items: { id: string }[] }>(request, acct, 'get', '/leads?q=Csv%20Unattested')).body.items[0]!.id;
  const view = await api<{ whatsapp: { marketing: string } }>(request, acct, 'get', `/leads/${id}/consents`);
  expect(view.body.whatsapp.marketing).toBe('NO_CONSENT');
});
