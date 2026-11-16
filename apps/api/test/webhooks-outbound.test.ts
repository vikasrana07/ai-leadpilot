import { createHmac } from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { WebhookDispatcher } from '../src/ops/webhook-dispatcher.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

// Local receivers live on 127.0.0.1, which the SSRF guard refuses unless this test-only switch is on (it is rejected in production).
Object.assign(process.env, { WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true', WEBHOOK_MAX_ATTEMPTS: '3', WEBHOOK_BACKOFF_BASE_MS: '20', WEBHOOK_DISABLE_AFTER: '2', WEBHOOK_TIMEOUT_MS: '400' });

let ctx: TestCtx; let relay: OutboxRelay; let disp: WebhookDispatcher; let t: Account; let other: Account;
const owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
interface Hit { headers: http.IncomingHttpHeaders; body: string }
interface Receiver { url: string; hits: Hit[]; mode: { status: number; hang?: boolean; redirect?: string }; close: () => void }
const receivers: Receiver[] = [];
async function receiver(): Promise<Receiver> {
  const hits: Hit[] = []; const mode: Receiver['mode'] = { status: 200 };
  const server = http.createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', (c: Buffer) => chunks.push(c)); req.on('end', () => {
    hits.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (mode.hang) return; if (mode.redirect) { res.writeHead(302, { location: mode.redirect }); return res.end(); } res.writeHead(mode.status); res.end('ok');
  }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const rec = { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`, hits, mode, close: () => server.close() }; receivers.push(rec); return rec;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pump(until: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Make waiting out a backoff instant (backoff DELAY is a scheduling detail; attempts/outcomes are what is asserted). Also keeps the test steady
    // if another worker process sharing this database claims a delivery with its own, slower backoff settings.
    await owner$.query(`UPDATE webhook_deliveries SET next_attempt_at = now() WHERE status = 'PENDING' AND tenant_id = ANY($1)`, [[t.tenantId, other.tenantId]]);
    await relay.drainOnce(100); await disp.drainOnce(50); if (await until()) return; await sleep(30); }
  throw new Error('pump timed out');
}
const create = (a: Account, url: string, events: string[]) => ctx.http().post('/webhooks/endpoints').set(auth(a.accessToken)).send({ url, events });
const verify = (h: Hit, secret: string) => { const ts = h.headers['x-leadpilot-timestamp'] as string; return h.headers['x-leadpilot-signature'] === `v1=${createHmac('sha256', secret).update(`${ts}.${h.body}`).digest('hex')}`; };
const mkLead = (a: Account, n: string) => ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: n, phone: `+9198${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}` });

beforeAll(async () => {
  ctx = await createTestApp(); relay = ctx.app.get(OutboxRelay); disp = ctx.app.get(WebhookDispatcher);
  t = await registerAccount(ctx, 'whOwner'); other = await registerAccount(ctx, 'whOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
});
afterAll(async () => { for (const r of receivers) r.close(); await owner$.end(); await ctx.close(); await cleanup(); });

describe('configuration', () => {
  it('shows the signing secret once, stores it encrypted, and never lists it', async () => {
    const rec = await receiver();
    const r = await create(t, rec.url, ['lead.created']);
    expect(r.status).toBe(201); expect(r.body.secret).toMatch(/^whsec_/);
    const row = (await owner$.query('SELECT secret_ciphertext, secret_prefix FROM webhook_endpoints WHERE id = $1', [r.body.id])).rows[0];
    expect(row.secret_ciphertext).not.toContain(r.body.secret.slice(7)); expect(row.secret_prefix).toBe(r.body.secret.slice(0, 12));
    const list = await ctx.http().get('/webhooks/endpoints').set(auth(t.accessToken));
    expect(JSON.stringify(list.body)).not.toContain(r.body.secret); expect(list.body.find((e: { id: string }) => e.id === r.body.id).secretPrefix).toBe(r.body.secret.slice(0, 12));
    await ctx.http().delete(`/webhooks/endpoints/${r.body.id}`).set(auth(t.accessToken));
  });
  it('validates events and url, and is limited to integration managers on plans with API access', async () => {
    expect((await create(t, 'https://example.com/h', ['not.an.event'])).status).toBe(400);
    expect((await create(t, 'ftp://example.com/h', ['lead.created'])).status).toBe(400);
    expect((await create(t, 'https://example.com/h', [])).status).toBe(400);
    const agent = await addMember(ctx, t, 'whAgent', 'agent');
    expect((await ctx.http().get('/webhooks/endpoints').set(auth(agent.accessToken))).status).toBe(403);
    const starter = await registerAccount(ctx, 'whStarter');
    await owner$.query(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, updated_at) VALUES (gen_random_uuid(), $1, 'starter', 'ACTIVE', 'manual', now())`, [starter.tenantId]);
    const r = await create(starter, 'https://example.com/h', ['lead.created']);
    expect(r.status).toBe(402); expect(r.body.error.code).toBe('feature_not_in_plan');
  });
});

describe('delivery', () => {
  it('sends a signed event for a real domain change, with timestamp, event headers and an id-only payload', async () => {
    const rec = await receiver(); const ep = (await create(t, rec.url, ['lead.created'])).body;
    const lead = (await mkLead(t, 'Webhook Lead')).body;
    await pump(() => rec.hits.length > 0);
    const h = rec.hits[0] as Hit; const body = JSON.parse(h.body);
    expect(h.headers['x-leadpilot-event']).toBe('lead.created'); expect(h.headers['content-type']).toBe('application/json');
    expect(verify(h, ep.secret)).toBe(true); expect(verify(h, `${ep.secret}x`)).toBe(false);
    expect(Math.abs(Number(h.headers['x-leadpilot-timestamp']) - Date.now() / 1000)).toBeLessThan(30);
    expect(body).toMatchObject({ type: 'lead.created', test: false }); expect(body.data.leadId).toBe(lead.id); expect(body.id).toBeTruthy();
    expect(h.body).not.toContain('Webhook Lead'); // no personal fields in the body
    // a tampered body fails verification (what a receiver checks)
    expect(verify({ ...h, body: h.body.replace('lead.created', 'lead.deleted') }, ep.secret)).toBe(false);
    const d = (await ctx.http().get(`/webhooks/endpoints/${ep.id}/deliveries`).set(auth(t.accessToken))).body[0];
    expect(d).toMatchObject({ status: 'SUCCEEDED', statusCode: 200, attempts: 1, eventType: 'lead.created' }); expect(d.latencyMs).toBeGreaterThanOrEqual(0);
    expect(rec.hits).toHaveLength(1); // exactly once per event per endpoint
  });

  it('delivers only the events an endpoint subscribed to', async () => {
    const rec = await receiver(); await create(t, rec.url, ['lead.stage_changed']);
    const l = (await mkLead(t, 'Filter Lead')).body;
    await pump(async () => (await owner$.query(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1 AND status IN ('pending','processing')`, [t.tenantId])).rows[0].n === 0);
    expect(rec.hits).toHaveLength(0);
    const stages = (await ctx.http().get('/pipeline/stages').set(auth(t.accessToken))).body.stages as { id: string; kind: string }[];
    await ctx.http().post(`/leads/${l.id}/stage`).set(auth(t.accessToken)).send({ stageId: stages.filter((s) => s.kind === 'OPEN')[1]?.id });
    await pump(() => rec.hits.length > 0);
    expect(JSON.parse((rec.hits[0] as Hit).body).type).toBe('lead.stage_changed');
  });

  it('retries with backoff until the receiver recovers, then records success', async () => {
    const rec = await receiver(); rec.mode.status = 500; const ep = (await create(t, rec.url, ['lead.created'])).body;
    await mkLead(t, 'Retry Lead');
    await pump(() => rec.hits.length >= 2);
    rec.mode.status = 200;
    await pump(async () => (await owner$.query(`SELECT status FROM webhook_deliveries WHERE endpoint_id = $1`, [ep.id])).rows[0]?.status === 'SUCCEEDED');
    const d = (await owner$.query(`SELECT attempts, last_error FROM webhook_deliveries WHERE endpoint_id = $1`, [ep.id])).rows[0];
    expect(d.attempts).toBe(3); expect(d.last_error).toBeNull(); expect(rec.hits).toHaveLength(3);
  });

  it('gives up after the maximum attempts (FAILED), keeps the reason, and a manual redeliver works once the receiver is fixed', async () => {
    const rec = await receiver(); rec.mode.status = 503; const ep = (await create(t, rec.url, ['lead.created'])).body;
    await mkLead(t, 'Dead Letter');
    await pump(async () => (await owner$.query(`SELECT status FROM webhook_deliveries WHERE endpoint_id = $1`, [ep.id])).rows[0]?.status === 'FAILED');
    const failed = (await ctx.http().get(`/webhooks/endpoints/${ep.id}/deliveries`).set(auth(t.accessToken))).body[0];
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 3, statusCode: 503 }); expect(failed.error).toMatch(/HTTP 503/);
    rec.mode.status = 200;
    expect((await ctx.http().post(`/webhooks/deliveries/${failed.id}/redeliver`).set(auth(t.accessToken))).status).toBe(200);
    await pump(async () => (await owner$.query(`SELECT status FROM webhook_deliveries WHERE id = $1`, [failed.id])).rows[0]?.status === 'SUCCEEDED');
    expect(rec.hits.length).toBe(4); // 3 failed attempts + the successful redelivery
  });

  it('switches an endpoint off after sustained failures, tells the owners, stops delivering, and re-enabling resets it', async () => {
    const rec = await receiver(); rec.mode.status = 500; const ep = (await create(t, rec.url, ['lead.created'])).body;
    await mkLead(t, 'Sustained A'); await mkLead(t, 'Sustained B');
    await pump(async () => (await owner$.query(`SELECT enabled FROM webhook_endpoints WHERE id = $1`, [ep.id])).rows[0]?.enabled === false);
    const row = (await owner$.query(`SELECT disabled_reason, consecutive_failures FROM webhook_endpoints WHERE id = $1`, [ep.id])).rows[0];
    expect(row.disabled_reason).toMatch(/automatically/); expect(row.consecutive_failures).toBeGreaterThanOrEqual(2);
    expect((await owner$.query(`SELECT count(*)::int n FROM notifications WHERE tenant_id = $1 AND type = 'integration'`, [t.tenantId])).rows[0].n).toBeGreaterThan(0);
    const before = rec.hits.length; await mkLead(t, 'After Disable'); await relay.drainOnce(100); await disp.drainOnce(50); await sleep(100); await disp.drainOnce(50);
    expect(rec.hits.length).toBe(before);
    rec.mode.status = 200;
    const re = await ctx.http().patch(`/webhooks/endpoints/${ep.id}`).set(auth(t.accessToken)).send({ enabled: true });
    expect(re.body).toMatchObject({ enabled: true, consecutiveFailures: 0, disabledReason: null });
  });

  it('does not follow a redirect to a private address and reports it', async () => {
    const inner = await receiver(); const rec = await receiver(); rec.mode.redirect = inner.url;
    const ep = (await create(t, rec.url, ['lead.created'])).body;
    const r = await ctx.http().post(`/webhooks/endpoints/${ep.id}/test`).set(auth(t.accessToken));
    expect(r.body.status).toBe('PENDING'); expect(r.body.error).toMatch(/Redirects are not followed/); expect(inner.hits).toHaveLength(0);
  });

  it('times out a receiver that never answers', async () => {
    const rec = await receiver(); rec.mode.hang = true; const ep = (await create(t, rec.url, ['lead.created'])).body;
    const r = await ctx.http().post(`/webhooks/endpoints/${ep.id}/test`).set(auth(t.accessToken));
    expect(r.body.error).toBe('Timed out');
  });

  it('"Send test event" delivers a flagged test payload immediately and shows the outcome', async () => {
    const rec = await receiver(); const ep = (await create(t, rec.url, ['lead.created'])).body;
    const r = await ctx.http().post(`/webhooks/endpoints/${ep.id}/test`).set(auth(t.accessToken));
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: 'SUCCEEDED', test: true, eventType: 'webhook.test' }); expect(r.body.payload.test).toBe(true);
    expect(verify(rec.hits[0] as Hit, ep.secret)).toBe(true);
  });

  it('rotating the secret takes effect immediately: new events are signed with the new secret only', async () => {
    const rec = await receiver(); const ep = (await create(t, rec.url, ['lead.created'])).body;
    const rot = (await ctx.http().post(`/webhooks/endpoints/${ep.id}/rotate-secret`).set(auth(t.accessToken))).body.secret as string;
    expect(rot).not.toBe(ep.secret);
    await ctx.http().post(`/webhooks/endpoints/${ep.id}/test`).set(auth(t.accessToken));
    const h = rec.hits[0] as Hit; expect(verify(h, rot)).toBe(true); expect(verify(h, ep.secret)).toBe(false);
  });
});

describe('isolation and plan rules', () => {
  it('never shows, changes or delivers across workspaces', async () => {
    const mine = await receiver(); const theirs = await receiver();
    const epMine = (await create(t, mine.url, ['lead.created'])).body; const epTheirs = (await create(other, theirs.url, ['lead.created'])).body;
    for (const [m, p] of [['patch', `/webhooks/endpoints/${epTheirs.id}`], ['delete', `/webhooks/endpoints/${epTheirs.id}`], ['post', `/webhooks/endpoints/${epTheirs.id}/test`], ['post', `/webhooks/endpoints/${epTheirs.id}/rotate-secret`], ['get', `/webhooks/endpoints/${epTheirs.id}/deliveries`]] as const) {
      expect((await ctx.http()[m](p).set(auth(t.accessToken)).send({})).status, `${m} ${p}`).toBe(404);
    }
    expect((await ctx.http().get('/webhooks/endpoints').set(auth(t.accessToken))).body.map((e: { id: string }) => e.id)).not.toContain(epTheirs.id);
    await mkLead(t, 'Isolation Lead');
    await pump(() => mine.hits.length > 0); await sleep(150); await disp.drainOnce(50);
    expect(theirs.hits).toHaveLength(0); expect(epMine.id).not.toBe(epTheirs.id);
  });

  it('stops delivering when the plan no longer includes API access', async () => {
    const rec = await receiver(); await create(t, rec.url, ['lead.created']);
    await owner$.query(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, updated_at) VALUES (gen_random_uuid(), $1, 'starter', 'ACTIVE', 'manual', now()) ON CONFLICT (tenant_id) DO UPDATE SET plan_key = 'starter'`, [t.tenantId]);
    try {
      await owner$.query(`UPDATE tenants SET plan_key = 'starter' WHERE id = $1`, [t.tenantId]);
      await mkLead(t, 'Plan Lead').catch(() => undefined);
      for (let i = 0; i < 5; i++) { await relay.drainOnce(100); await disp.drainOnce(50); await sleep(30); }
      expect(rec.hits).toHaveLength(0);
    } finally { await owner$.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [t.tenantId]); await owner$.query(`UPDATE tenants SET plan_key = 'internal' WHERE id = $1`, [t.tenantId]); }
  });
});

describe('SSRF guard at configuration time (private targets NOT allowed)', () => {
  it('rejects loopback, private, metadata, obfuscated and non-https URLs with a clear error', async () => {
    const prev = process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS; process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'false';
    const c2 = await createTestApp();
    try {
      const a = await registerAccount(c2, 'whSsrf');
      for (const url of ['https://127.0.0.1/h', 'https://localhost/h', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/h', 'https://192.168.1.10/h', 'https://[::1]/h', 'https://[::ffff:7f00:1]/h', 'https://2130706433/h', 'https://0x7f000001/h', 'http://example.com/h']) {
        const r = await c2.http().post('/webhooks/endpoints').set(auth(a.accessToken)).send({ url, events: ['lead.created'] });
        expect(r.status, url).toBe(400);
      }
    } finally { process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = prev; await c2.close(); }
  });
});
