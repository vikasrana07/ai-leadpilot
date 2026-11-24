import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Retry of failed recipients. A definite failure can be re-sent; a recipient whose delivery state is UNKNOWN (the sender was interrupted)
 * may already have received the message, so it is only retried when the user says so. Cancelled rows are never retried.
 * Fixtures use the OWNER role; the retry itself goes through HTTP and RLS.
 */
let ctx: TestCtx; let db: pg.Pool; let owner: Account; let agent: Account; let svc: CampaignsService;
const leads: string[] = [];
const ids = { channel: randomUUID(), template: randomUUID() };

const mkCampaign = async (status: string, failedCount: number) => {
  const id = randomUUID();
  await db.query(`INSERT INTO broadcast_campaigns (id, tenant_id, name, status, channel_id, template_id, template_name, template_language, failed_count, completed_at, updated_at) VALUES ($1, $2, 'Retry', $3::"BroadcastCampaignStatus", $4, $5, 't', 'en', $6, now(), now())`, [id, owner.tenantId, status, ids.channel, ids.template, failedCount]);
  return id;
};
const rec = (campaignId: string, i: number, status: string, error: object | null = null) => db.query(
  `INSERT INTO broadcast_recipients (id, tenant_id, campaign_id, lead_id, phone, status, error, updated_at) VALUES ($1, $2, $3, $4, $5, $6::"BroadcastRecipientStatus", $7::jsonb, now())`,
  [randomUUID(), owner.tenantId, campaignId, leads[i], `91980000070${i}`, status, error ? JSON.stringify(error) : null],
);
const statusOf = async (campaignId: string) => Object.fromEntries((await db.query(`SELECT lead_id, status FROM broadcast_recipients WHERE campaign_id = $1`, [campaignId])).rows.map((r) => [r.lead_id, r.status as string]));
const retry = (token: string, campaignId: string, body: object = {}) => ctx.http().post(`/campaigns/${campaignId}/retry-failed`).set(auth(token)).send(body);

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'retryOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'retryAgent', 'agent');
  for (let i = 0; i < 5; i++) {
    const res = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Lead ${i}`, phone: `+91980000070${i}` });
    leads.push(res.body.id);
  }
  await db.query(`INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at) VALUES ($1, $2, 'WHATSAPP', 'Retry', 'ACTIVE', $3, '{}'::jsonb, now())`, [ids.channel, owner.tenantId, `retry-${ids.channel}`]);
  await db.query(`INSERT INTO whatsapp_templates (id, tenant_id, name, language, category, body_preview, variable_count, source) VALUES ($1, $2, 't', 'en', 'MARKETING', 'Hi', 0, 'manual')`, [ids.template, owner.tenantId]);
  svc = ctx.app.get(CampaignsService);
  svc.enqueueDispatch = vi.fn().mockResolvedValue(undefined); // the dispatch itself is covered by campaign-dispatch-safety.test.ts
});

afterAll(async () => {
  await db.query('DELETE FROM broadcast_recipients WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM broadcast_campaigns WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM whatsapp_templates WHERE id = $1', [ids.template]);
  await db.query('DELETE FROM channels WHERE id = $1', [ids.channel]);
  await db.end();
  await ctx.close();
  await cleanup();
});

describe('retry failed recipients', () => {
  it('re-queues definite failures only, leaves unknown-outcome and cancelled rows, fixes the counter and restarts the run', async () => {
    const c = await mkCampaign('COMPLETED', 4);
    await rec(c, 0, 'SENT');
    await rec(c, 1, 'FAILED', { message: 'phone number not registered' });
    await rec(c, 2, 'FAILED', { message: 'Delivery state unknown', code: 'interrupted' });
    await rec(c, 3, 'FAILED', { message: 'Campaign was cancelled by user' });
    await rec(c, 4, 'FAILED', { message: 'template paused' });
    const detail = await ctx.http().get(`/campaigns/${c}`).set(auth(owner.accessToken));
    expect(detail.body).toMatchObject({ retryableCount: 2, interruptedCount: 1 });

    const res = await retry(owner.accessToken, c);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'RUNNING', retried: 2 });
    expect(await statusOf(c)).toEqual({ [leads[0]!]: 'SENT', [leads[1]!]: 'PENDING', [leads[2]!]: 'FAILED', [leads[3]!]: 'FAILED', [leads[4]!]: 'PENDING' });
    const row = (await db.query('SELECT status, failed_count, completed_at FROM broadcast_campaigns WHERE id = $1', [c])).rows[0];
    expect(row).toMatchObject({ status: 'RUNNING', failed_count: 2, completed_at: null });
    expect(svc.enqueueDispatch).toHaveBeenCalledWith(owner.tenantId, c);
    const cleared = (await db.query(`SELECT error FROM broadcast_recipients WHERE campaign_id = $1 AND lead_id = $2`, [c, leads[1]])).rows[0];
    expect(cleared.error).toBeNull();
  });

  it('retries unknown-outcome recipients only when explicitly asked', async () => {
    const c = await mkCampaign('COMPLETED', 1);
    await rec(c, 2, 'FAILED', { message: 'Delivery state unknown', code: 'interrupted' });
    const refused = await retry(owner.accessToken, c);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('nothing_to_retry');
    expect((await statusOf(c))[leads[2]!]).toBe('FAILED'); // untouched
    const ok = await retry(owner.accessToken, c, { includeInterrupted: true });
    expect(ok.status).toBe(200);
    expect((await statusOf(c))[leads[2]!]).toBe('PENDING');
  });

  it('only a completed campaign can be retried, and only by someone who can manage campaigns', async () => {
    const running = await mkCampaign('RUNNING', 1);
    await rec(running, 1, 'FAILED', { message: 'x' });
    expect((await retry(owner.accessToken, running)).status).toBe(409);
    const done = await mkCampaign('COMPLETED', 1);
    await rec(done, 1, 'FAILED', { message: 'x' });
    expect((await retry(agent.accessToken, done)).status).toBe(403);
    expect((await retry(owner.accessToken, randomUUID())).status).toBe(404);
  });

  it('two simultaneous retries start one run', async () => {
    const c = await mkCampaign('COMPLETED', 1);
    await rec(c, 1, 'FAILED', { message: 'x' });
    const results = await Promise.all([retry(owner.accessToken, c), retry(owner.accessToken, c)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.query('SELECT failed_count FROM broadcast_campaigns WHERE id = $1', [c])).rows[0].failed_count).toBe(0);
  });
});
