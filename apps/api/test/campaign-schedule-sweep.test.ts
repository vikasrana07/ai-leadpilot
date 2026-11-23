import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-04 (docs/product-architecture-audit/08-security-assessment.md): `CampaignsService.checkScheduledCampaigns`
 * sweeps every tenant for due SCHEDULED campaigns, but it queries `broadcast_campaigns` through the RLS-bound runtime role
 * (`leadpilot_app`) with no `app.tenant_id` set. The `tenant_isolation` policy then hides every row, so due campaigns are never found.
 *
 * Fixtures are written with the OWNER role (RLS does not apply to it) so the only thing under test is whether the app-role sweep sees them.
 * The workspace has no leads, so a launched campaign completes immediately and nothing is sent.
 */
let ctx: TestCtx;
let owner: pg.Pool;
let account: Account;
const ids = { channel: randomUUID(), template: randomUUID(), campaign: randomUUID() };

beforeAll(async () => {
  ctx = await createTestApp();
  owner = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  account = await registerAccount(ctx, 'sweep');
  await owner.query(
    `INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at)
     VALUES ($1, $2, 'WHATSAPP', 'Sweep test channel', 'ACTIVE', $3, '{}'::jsonb, now())`,
    [ids.channel, account.tenantId, `sweep-${ids.channel}`],
  );
  await owner.query(
    `INSERT INTO whatsapp_templates (id, tenant_id, name, language, category, body_preview, variable_count, source)
     VALUES ($1, $2, 'sweep_test', 'en', 'UTILITY', 'Hello', 0, 'manual')`,
    [ids.template, account.tenantId],
  );
  await owner.query(
    `INSERT INTO broadcast_campaigns (id, tenant_id, name, status, channel_id, template_id, template_name, template_language, scheduled_at, updated_at)
     VALUES ($1, $2, 'Due scheduled campaign', 'SCHEDULED', $3, $4, 'sweep_test', 'en', now() - interval '5 minutes', now())`,
    [ids.campaign, account.tenantId, ids.channel, ids.template],
  );
});

afterAll(async () => {
  await owner.query('DELETE FROM broadcast_recipients WHERE campaign_id = $1', [ids.campaign]);
  await owner.query('DELETE FROM broadcast_campaigns WHERE id = $1', [ids.campaign]);
  await owner.query('DELETE FROM whatsapp_templates WHERE id = $1', [ids.template]);
  await owner.query('DELETE FROM channels WHERE id = $1', [ids.channel]);
  await owner.end();
  await ctx.close();
  await cleanup();
});

describe('scheduled campaign sweep under row-level security', () => {
  it('control: the fixture is a due SCHEDULED campaign visible to the owner role, so a miss below is the sweep, not the setup', async () => {
    const { rows } = await owner.query("SELECT count(*)::int AS n FROM broadcast_campaigns WHERE id = $1 AND status = 'SCHEDULED' AND scheduled_at <= now()", [ids.campaign]);
    expect(rows[0].n).toBe(1);
  });

  it('finds and launches a due SCHEDULED campaign when called with no tenant context (as the worker does)', async () => {
    const launched = await ctx.app.get(CampaignsService).checkScheduledCampaigns();
    const { rows } = await owner.query('SELECT status FROM broadcast_campaigns WHERE id = $1', [ids.campaign]);
    expect(launched, 'sweep found no due campaigns: RLS hides them from the app role without tenant context').toBeGreaterThanOrEqual(1);
    expect(rows[0].status, 'campaign is still SCHEDULED after the sweep').not.toBe('SCHEDULED');
  });
});
