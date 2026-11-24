import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { ChannelsService } from '../src/channels/channels.module.js';
import { WHATSAPP_CLIENT, WhatsAppApiError, type WhatsAppClient } from '../src/whatsapp/whatsapp.client.js';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-02: the campaign sender read PENDING recipients, sent, then wrote the result, with no claim. Concurrent dispatchers or a
 * retried job could message the same lead twice, an interrupted worker's recipients were re-sent, a provider rate limit burned the audience
 * as failures, two launches could both proceed, and a cancel did not stop a batch in flight. WhatsApp has no idempotency key, so the
 * guarantee is at-most-once: rows are claimed atomically and an unknown outcome is never resent.
 * Fixtures are written with the OWNER role; the service runs through the real app, HTTP, and RLS.
 */
const N = 12;
let ctx: TestCtx; let db: pg.Pool; let owner: Account; let svc: CampaignsService; let wa: WhatsAppClient;
const leadIds: string[] = []; const phones: string[] = [];
const ids = { channel: randomUUID(), template: randomUUID() };
let sends: string[] = [];

const campaignRow = (id: string, status: string) => db.query(
  `INSERT INTO broadcast_campaigns (id, tenant_id, name, status, channel_id, template_id, template_name, template_language, updated_at) VALUES ($1, $2, 'Safety', $3::"BroadcastCampaignStatus", $4, $5, 'safety_tpl', 'en', now())`,
  [id, owner.tenantId, status, ids.channel, ids.template],
);
const recipient = (campaignId: string, i: number, status: string, claimedMinutesAgo: number | null = null) => db.query(
  `INSERT INTO broadcast_recipients (id, tenant_id, campaign_id, lead_id, phone, status, claimed_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::"BroadcastRecipientStatus", ${claimedMinutesAgo === null ? 'NULL' : `now() - interval '${claimedMinutesAgo} minutes'`}, now())`,
  [randomUUID(), owner.tenantId, campaignId, leadIds[i], phones[i], status],
);
const statuses = async (campaignId: string) => Object.fromEntries((await db.query(`SELECT status, count(*)::int AS n FROM broadcast_recipients WHERE campaign_id = $1 GROUP BY 1`, [campaignId])).rows.map((r) => [r.status, r.n as number]));
const campaignStatus = async (id: string) => (await db.query('SELECT status FROM broadcast_campaigns WHERE id = $1', [id])).rows[0].status as string;
const fresh = async (status = 'RUNNING') => { const id = randomUUID(); await campaignRow(id, status); return id; };

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'dispatchSafety');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  for (let i = 0; i < N; i++) {
    const phone = `+9198000005${String(i).padStart(2, '0')}`;
    const res = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: `Lead ${i}`, phone });
    expect(res.status).toBe(201);
    leadIds.push(res.body.id); phones.push(phone.replace('+', ''));
    await db.query(`INSERT INTO consents (id, tenant_id, lead_id, channel, status, source) VALUES ($1, $2, $3, 'whatsapp', 'OPTED_IN', 'test')`, [randomUUID(), owner.tenantId, res.body.id]);
  }
  await db.query(`INSERT INTO channels (id, tenant_id, type, name, status, external_id, config, updated_at) VALUES ($1, $2, 'WHATSAPP', 'Safety', 'ACTIVE', $3, '{}'::jsonb, now())`, [ids.channel, owner.tenantId, `safety-${ids.channel}`]);
  await db.query(`INSERT INTO whatsapp_templates (id, tenant_id, name, language, category, body_preview, variable_count, source) VALUES ($1, $2, 'safety_tpl', 'en', 'MARKETING', 'Hello', 0, 'manual')`, [ids.template, owner.tenantId]);
  svc = ctx.app.get(CampaignsService);
  wa = ctx.app.get(WHATSAPP_CLIENT);
  vi.spyOn(ctx.app.get(ChannelsService), 'credentialsFor').mockResolvedValue({ channel: { id: ids.channel, externalId: 'wa_phone', status: 'ACTIVE' }, creds: { accessToken: 't' } } as never);
});

beforeEach(() => {
  sends = [];
  vi.spyOn(wa, 'sendTemplate').mockImplementation(async (_id, _c, to) => { sends.push(to); return { messageId: `wamid.${randomUUID()}` } as never; });
  svc.enqueueDispatch = vi.fn().mockResolvedValue(undefined); // the test drives the loop itself
});

afterAll(async () => {
  await db.query('DELETE FROM broadcast_recipients WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM broadcast_campaigns WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM whatsapp_templates WHERE id = $1', [ids.template]);
  await db.query('DELETE FROM consents WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM messages WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM conversations WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM channels WHERE id = $1', [ids.channel]);
  await db.end();
  await ctx.close();
  await cleanup();
});

describe('campaign dispatch is at-most-once', () => {
  it('concurrent dispatchers (and retried jobs) send to each recipient exactly once', async () => {
    const c = await fresh();
    for (let i = 0; i < N; i++) await recipient(c, i, 'PENDING');
    for (let round = 0; round < 8 && (await statuses(c)).PENDING; round++) {
      await Promise.all([1, 2, 3].map(() => svc.dispatchBatch(owner.tenantId, c, 4)));
    }
    expect(sends).toHaveLength(N);
    expect(new Set(sends).size).toBe(N); // no duplicate number
    expect(await statuses(c)).toEqual({ SENT: N });
    expect(await campaignStatus(c)).toBe('COMPLETED');
  });

  it('never resends a recipient whose worker was interrupted: marks it failed as unknown, leaves fresh claims alone', async () => {
    const c = await fresh();
    await recipient(c, 0, 'QUEUED', 20); await recipient(c, 1, 'QUEUED', 20); // claimed 20 min ago: lease expired
    await recipient(c, 2, 'QUEUED', 1);                                         // claimed 1 min ago: another worker may still be sending
    await recipient(c, 3, 'PENDING');
    await svc.dispatchBatch(owner.tenantId, c, 10);
    expect(sends).toEqual([phones[3]]); // only the PENDING one
    const rows = (await db.query(`SELECT lead_id, status, error FROM broadcast_recipients WHERE campaign_id = $1`, [c])).rows;
    const by = (i: number) => rows.find((r) => r.lead_id === leadIds[i]);
    expect(by(0).status).toBe('FAILED'); expect(by(0).error.code).toBe('interrupted');
    expect(by(1).status).toBe('FAILED');
    expect(by(2).status).toBe('QUEUED');
    expect(by(3).status).toBe('SENT');
    expect(await campaignStatus(c)).toBe('RUNNING'); // still a claim outstanding: not complete
    const failed = (await db.query('SELECT failed_count FROM broadcast_campaigns WHERE id = $1', [c])).rows[0].failed_count;
    expect(failed).toBe(2);
  });

  it('a WhatsApp rate limit releases the rest of the batch and resumes later instead of failing the audience', async () => {
    const c = await fresh();
    for (let i = 0; i < 6; i++) await recipient(c, i, 'PENDING');
    let calls = 0;
    vi.spyOn(wa, 'sendTemplate').mockImplementation(async (_id, _c, to) => {
      if (++calls === 3) throw new WhatsAppApiError('Rate limit hit', true, 130429, 45);
      sends.push(to); return { messageId: `wamid.${randomUUID()}` } as never;
    });
    await svc.dispatchBatch(owner.tenantId, c, 6);
    expect(await statuses(c)).toEqual({ SENT: 2, PENDING: 4 }); // nothing failed
    expect(svc.enqueueDispatch).toHaveBeenCalledWith(owner.tenantId, c, 45_000);
    expect(await campaignStatus(c)).toBe('RUNNING');
  });

  it('a cancel stops a batch that is already in flight and is not overwritten by completion', async () => {
    const c = await fresh();
    for (let i = 0; i < 5; i++) await recipient(c, i, 'PENDING');
    vi.spyOn(wa, 'sendTemplate').mockImplementation(async (_id, _c, to) => {
      sends.push(to);
      if (sends.length === 1) await db.query(`UPDATE broadcast_campaigns SET status = 'CANCELLED' WHERE id = $1`, [c]);
      return { messageId: `wamid.${randomUUID()}` } as never;
    });
    await svc.dispatchBatch(owner.tenantId, c, 5);
    expect(sends).toHaveLength(1);
    expect(await statuses(c)).toEqual({ SENT: 1, FAILED: 4 });
    expect(await campaignStatus(c)).toBe('CANCELLED');
  });
});

describe('campaign launch is a compare-and-set', () => {
  it('two simultaneous launches: exactly one wins, the other gets 409, recipients are created once', async () => {
    const c = await fresh('DRAFT');
    const launch = () => ctx.http().post(`/campaigns/${c}/launch`).set(auth(owner.accessToken));
    const results = await Promise.all([launch(), launch(), launch()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const { rows } = await db.query('SELECT count(*)::int AS n, count(DISTINCT lead_id)::int AS d FROM broadcast_recipients WHERE campaign_id = $1', [c]);
    expect(rows[0].n).toBe(rows[0].d); // one row per lead
    expect(rows[0].n).toBeGreaterThanOrEqual(N);
  });
});
