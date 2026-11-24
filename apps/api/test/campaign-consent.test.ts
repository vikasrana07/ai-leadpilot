import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-01: broadcast campaigns messaged every lead without an OPTED_OUT row, including leads imported by CSV/API that never
 * opted in. WhatsApp marketing now needs an explicit opt-in; a STOP always wins; managers can attest opt-in for existing leads.
 * Consent rows and campaign fixtures are written with the OWNER role; everything else goes through HTTP and RLS.
 */
let ctx: TestCtx;
let db: pg.Pool;
let owner: Account; let agent: Account;
const lead: Record<'optedIn' | 'never' | 'stopped', string> = { optedIn: '', never: '', stopped: '' };
const ids = { channel: randomUUID(), template: randomUUID(), campaign: randomUUID() };

const mk = async (name: string, n: number) => {
  const res = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name, phone: `+9198000004${String(n).padStart(2, '0')}` });
  expect(res.status).toBe(201);
  return res.body.id as string;
};
const consent = (leadId: string, status: 'OPTED_IN' | 'OPTED_OUT', ageSeconds: number) => db.query(
  `INSERT INTO consents (id, tenant_id, lead_id, channel, status, source, created_at) VALUES ($1, $2, $3, 'whatsapp', $4::"ConsentStatus", 'test', now() - ($5 || ' seconds')::interval)`,
  [randomUUID(), owner.tenantId, leadId, status, String(ageSeconds)],
);

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'consentOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'consentAgent', 'agent');
  lead.optedIn = await mk('Opted In', 1); lead.never = await mk('Never Asked', 2); lead.stopped = await mk('Stopped', 3);
  await consent(lead.optedIn, 'OPTED_IN', 60);
  await consent(lead.stopped, 'OPTED_IN', 120); await consent(lead.stopped, 'OPTED_OUT', 30); // STOP is the latest
  await db.query(`INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at) VALUES ($1, $2, 'WHATSAPP', 'Consent test', 'ACTIVE', $3, '{}'::jsonb, now())`, [ids.channel, owner.tenantId, `consent-${ids.channel}`]);
  await db.query(`INSERT INTO whatsapp_templates (id, tenant_id, name, language, category, body_preview, variable_count, source) VALUES ($1, $2, 'consent_test', 'en', 'MARKETING', 'Hello', 0, 'manual')`, [ids.template, owner.tenantId]);
  await db.query(`INSERT INTO broadcast_campaigns (id, tenant_id, name, status, channel_id, template_id, template_name, template_language, updated_at) VALUES ($1, $2, 'Consent campaign', 'DRAFT', $3, $4, 'consent_test', 'en', now())`, [ids.campaign, owner.tenantId, ids.channel, ids.template]);
});

afterAll(async () => {
  await db.query('DELETE FROM broadcast_recipients WHERE campaign_id = $1', [ids.campaign]);
  await db.query('DELETE FROM broadcast_campaigns WHERE id = $1', [ids.campaign]);
  await db.query('DELETE FROM whatsapp_templates WHERE id = $1', [ids.template]);
  await db.query('DELETE FROM consents WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM channels WHERE id = $1', [ids.channel]);
  await db.end();
  await ctx.close();
  await cleanup();
});

const preview = () => ctx.http().post('/campaigns/preview').set(auth(owner.accessToken)).send({ segment: { stageIds: [], tagIds: [], sourceIds: [], temperatures: [] } });
const optIn = (token: string, leadIds: string[], body: object = {}) => ctx.http().post('/campaigns/consent/opt-in').set(auth(token)).send({ leadIds, basis: 'existing_customer', attestation: true, ...body });

describe('campaign consent', () => {
  it('previews three groups: opted in, never asked, and stopped', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalMatching: 3, eligibleCount: 1, optOutCount: 1, noConsentCount: 1 });
  });

  it('opt-in recording needs campaign:manage and lead:write:all, and an explicit attestation', async () => {
    expect((await optIn(agent.accessToken, [lead.never])).status).toBe(403);
    const res = await optIn(owner.accessToken, [lead.never], { attestation: false });
    expect(res.status).toBe(400);
    expect((await ctx.http().post('/campaigns/consent/opt-in').set(auth(owner.accessToken)).send({ leadIds: [lead.never], basis: 'existing_customer' })).status).toBe(400);
  });

  it('records opt-in for never-asked leads, skips existing opt-ins, and never overrides a STOP', async () => {
    const res = await optIn(owner.accessToken, [lead.optedIn, lead.never, lead.stopped, randomUUID()]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: 1, alreadyOptedIn: 1, skippedOptedOut: 1, notFound: 1 });
    const after = await preview();
    expect(after.body).toMatchObject({ eligibleCount: 2, optOutCount: 1, noConsentCount: 0 });
    const { rows } = await db.query(`SELECT source FROM consents WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`, [lead.never]);
    expect(rows[0].source).toBe('manager_attested:existing_customer');
  });

  it('launching sends only to opted-in leads and records why the others were skipped', async () => {
    const res = await ctx.http().post(`/campaigns/${ids.campaign}/launch`).set(auth(owner.accessToken));
    expect(res.status).toBe(200);
    const { rows } = await db.query(`SELECT r.lead_id, r.status FROM broadcast_recipients r WHERE r.campaign_id = $1`, [ids.campaign]);
    const byLead = Object.fromEntries(rows.map((r) => [r.lead_id, r.status as string]));
    expect(byLead[lead.stopped]).toBe('SKIPPED_OPT_OUT');
    expect(['PENDING', 'QUEUED', 'SENT', 'DELIVERED']).toContain(byLead[lead.optedIn]);
    expect(['PENDING', 'QUEUED', 'SENT', 'DELIVERED']).toContain(byLead[lead.never]); // attested in the previous step
    const c = await db.query('SELECT opt_out_count, no_consent_count FROM broadcast_campaigns WHERE id = $1', [ids.campaign]);
    expect(c.rows[0]).toEqual({ opt_out_count: 1, no_consent_count: 0 });
  });
});
