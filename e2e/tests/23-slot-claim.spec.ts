import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, ownerPool, registerViaApi } from '../helpers.ts';

/** Slot Rescue: a customer opens the guest link from their message and claims a freed appointment slot, no sign-in. First one wins. */
test('a guest claims a rescued slot from the public link; the slot cannot be claimed twice', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'claim');
  const pool = ownerPool();
  try {
    const lead = (await api<{ id: string }>(request, acct, 'post', '/leads', { name: 'Guest Claimer', phone: '+919811400001' })).body.id;
    const membership = (await pool.query('SELECT id FROM memberships WHERE tenant_id = $1 LIMIT 1', [acct.tenantId])).rows[0].id as string;
    const token = `e2e-claim-${acct.tenantId}`;
    const starts = new Date(Date.now() + 3 * 86_400_000); starts.setMinutes(0, 0, 0);
    await pool.query(
      `INSERT INTO slot_rescue_offers (id, tenant_id, source_appointment_id, membership_id, title, location, starts_at, ends_at, status, claim_token, offered_lead_ids, expires_at, updated_at)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, 'Site visit: 3 BHK', 'Baner, Pune', $3, $4, 'OPEN', $5, ARRAY[$6]::uuid[], now() + interval '2 days', now())`,
      [acct.tenantId, membership, starts, new Date(starts.getTime() + 30 * 60_000), token, lead],
    );

    // no sign-in: the page is public
    await page.goto(`/p/claim/${token}?l=${lead}`);
    await expect(page.getByText('Priority slot opened')).toBeVisible();
    await expect(page.getByText(acct.businessName)).toBeVisible();
    await expect(page.getByText('Site visit: 3 BHK')).toBeVisible();
    await expect(page.getByText('Baner, Pune')).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations).toEqual([]);

    await page.getByRole('button', { name: 'Confirm this slot' }).click();
    await expect(page.getByText('Your slot is confirmed!')).toBeVisible();

    // the booking is real: the workspace now has the appointment for this lead
    const appts = await api<{ items: { leadId: string; title: string }[] }>(request, acct, 'get', '/appointments');
    expect(appts.body.items.some((a) => a.leadId === lead)).toBe(true);

    // opening the same link again: the slot is gone
    await page.goto(`/p/claim/${token}?l=${lead}`);
    await expect(page.getByText('No longer available')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm this slot' })).toHaveCount(0);
  } finally { await pool.end(); }
});

test('the claim page needs the full invitation link, and an unknown link says so', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'claim2');
  const pool = ownerPool();
  try {
    const lead = (await api<{ id: string }>(request, acct, 'post', '/leads', { name: 'Half Link', phone: '+919811400002' })).body.id;
    const membership = (await pool.query('SELECT id FROM memberships WHERE tenant_id = $1 LIMIT 1', [acct.tenantId])).rows[0].id as string;
    const token = `e2e-claim2-${acct.tenantId}`;
    const starts = new Date(Date.now() + 4 * 86_400_000);
    await pool.query(
      `INSERT INTO slot_rescue_offers (id, tenant_id, source_appointment_id, membership_id, title, starts_at, ends_at, status, claim_token, offered_lead_ids, expires_at, updated_at)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, 'Consultation', $3, $4, 'OPEN', $5, ARRAY[$6]::uuid[], now() + interval '2 days', now())`,
      [acct.tenantId, membership, starts, new Date(starts.getTime() + 30 * 60_000), token, lead],
    );

    await page.goto(`/p/claim/${token}`); // the guest parameter is missing
    await expect(page.getByRole('button', { name: 'Confirm this slot' })).toBeDisabled();
    await expect(page.getByText('Open the full link from your invitation message to claim this slot.')).toBeVisible();

    await page.goto('/p/claim/not-a-real-token?l=00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading', { level: 1, name: 'Offer unavailable' })).toBeVisible();
  } finally { await pool.end(); }
});
