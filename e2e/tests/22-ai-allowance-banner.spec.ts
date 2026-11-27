import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, ownerPool, registerViaApi, signInViaApi } from '../helpers.ts';

/** The monthly AI allowance is announced on every screen before it runs out, so the AI never just stops without explanation. */
test('the AI allowance banner appears at 95%, can be dismissed, and cannot be dismissed once the limit is reached', async ({ page, request }) => {
  const acct = await registerViaApi(request, 'aicap');
  const pool = ownerPool();
  try {
    // usage is counted from ai_runs; give the tenant a conversation to attach them to
    const lead = (await api<{ id: string }>(request, acct, 'post', '/leads', { name: 'Cap Lead', phone: '+919811300001' })).body.id;
    const channel = (await pool.query(`INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at) VALUES (gen_random_uuid(), $1, 'WHATSAPP', 'Cap line', 'ACTIVE', $2, '{}'::jsonb, now()) RETURNING id`, [acct.tenantId, `e2e-cap-${acct.tenantId}`])).rows[0].id as string;
    const conv = (await pool.query(`INSERT INTO conversations (id, tenant_id, channel_id, lead_id, external_thread_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`, [acct.tenantId, channel, lead, `e2e-thread-${acct.tenantId}`])).rows[0].id as string;
    const addTokens = (n: number) => pool.query(`INSERT INTO ai_runs (id, tenant_id, conversation_id, status, prompt_version, input_tokens, output_tokens) VALUES (gen_random_uuid(), $1, $2, 'COMPLETED', 'v1.0', $3, 0)`, [acct.tenantId, conv, n]);
    const cap = (await api<{ cap: number }>(request, acct, 'get', '/ai/usage')).body.cap;

    await signInViaApi(page, acct);

    // well under the limit: no banner
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
    await expect(page.getByText(/monthly AI limit|of this month's AI allowance/)).toHaveCount(0);

    // 96%: a warning with the right fix (the owner's own cap binds, so "Raise the AI limit"), on every screen
    await addTokens(Math.ceil(cap * 0.96));
    await page.goto('/leads');
    const warning = page.getByRole('status').filter({ hasText: 'Almost at the monthly AI limit' });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole('link', { name: 'Raise the AI limit' })).toHaveAttribute('href', '/ai-assistant');
    const axe = await new AxeBuilder({ page }).include('[role="status"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations).toEqual([]);

    // a warning can be dismissed, and stays dismissed
    await warning.getByRole('button', { name: 'Dismiss AI usage notice' }).click();
    await expect(warning).toHaveCount(0);
    await page.goto('/pipeline');
    await expect(page.getByText('Almost at the monthly AI limit')).toHaveCount(0);

    // the usage screen still tells the story, with the same call to action
    await page.goto('/usage');
    await expect(page.getByText('Almost at the monthly AI limit.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Raise the AI limit' })).toBeVisible();

    // past the cap: a limit-reached alert that cannot be dismissed
    await addTokens(Math.ceil(cap * 0.2));
    await page.goto('/leads');
    const reached = page.getByRole('alert').filter({ hasText: 'The monthly AI limit is reached' });
    await expect(reached).toBeVisible();
    await expect(reached).toContainText('New chats go to your team');
    await expect(reached.getByRole('button', { name: 'Dismiss AI usage notice' })).toHaveCount(0);
  } finally { await pool.end(); }
});
