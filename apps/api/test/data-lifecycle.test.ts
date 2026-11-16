import { gunzipSync } from 'node:zlib';
import argon2 from 'argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/ai/knowledge/storage.js';
import { MockBillingProvider } from '../src/billing/provider.js';
import { LifecycleJobs } from '../src/ops/lifecycle-jobs.js';
import { EXPORT_EXCLUDED, EXPORT_INCLUDED } from '../src/ops/export-tables.js';
import { addMember, auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

/** Retention purge, workspace export and workspace deletion. Destructive paths are checked for tenant isolation and idempotency. */
let ctx: TestCtx; let jobs: LifecycleJobs; let storage: ObjectStorage; let db: pg.Pool;
let a: Account; let b: Account;
const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
const n = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0].n as number;
const RETAINED = ['invoices', 'payments', 'platform_audit_logs'];

async function channel(t: Account): Promise<string> {
  const id = (await q(`INSERT INTO channels (id, tenant_id, type, name, updated_at) VALUES (gen_random_uuid(), $1, 'WEB_WIDGET', 'LC', now()) RETURNING id`, [t.tenantId])).rows[0].id as string;
  return id;
}
async function oldWebhook(t: Account, ch: string, daysAgo: number, tag: string) {
  await q(`INSERT INTO webhook_events (id, tenant_id, channel_id, provider, payload_hash, payload, status, created_at) VALUES (gen_random_uuid(), $1, $2, 'whatsapp', $3, '{"x":1}', 'processed', now() - make_interval(days => $4))`, [t.tenantId, ch, `${RUN}-${tag}`, daysAgo]);
}

beforeAll(async () => {
  ctx = await createTestApp(); jobs = ctx.app.get(LifecycleJobs); storage = ctx.app.get<ObjectStorage>(OBJECT_STORAGE, { strict: false });
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  a = await registerAccount(ctx, 'lcA'); b = await registerAccount(ctx, 'lcB');
  for (const x of [a, b]) await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', x.email)?.token });
});
afterAll(async () => { await ctx.close(); await cleanup(); await db.end(); });

describe('retention purge', () => {
  it('purges only what the policy allows, only in the right workspace, and is idempotent', async () => {
    const chA = await channel(a); const chB = await channel(b);
    await oldWebhook(a, chA, 45, 'a-old'); await oldWebhook(a, chA, 2, 'a-new'); await oldWebhook(b, chB, 45, 'b-old');
    const before = await ctx.http().post('/privacy/retention/preview').set(auth(a.accessToken)).send({});
    expect(before.status).toBe(200); expect(before.body.webhook_events).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM webhook_events WHERE tenant_id = $1`, [a.tenantId])).toBe(2); // a preview deletes nothing
    const first = await jobs.runRetention(a.tenantId);
    expect(first.webhook_events).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM webhook_events WHERE tenant_id = $1`, [a.tenantId])).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM webhook_events WHERE tenant_id = $1`, [b.tenantId])).toBe(1); // the other workspace is untouched
    expect(Object.values(await jobs.runRetention(a.tenantId)).every((v) => v === 0)).toBe(true); // idempotent
    const audit = await q(`SELECT metadata FROM audit_logs WHERE tenant_id = $1 AND action = 'privacy.retention_purged'`, [a.tenantId]);
    expect(audit.rows).toHaveLength(1); expect(JSON.stringify(audit.rows[0].metadata)).not.toMatch(/"x"|payload/);
  });

  it('runs at most once per workspace per day', async () => {
    const day = new Date('2031-01-05T10:00:00Z');
    expect(await jobs.retentionTick(a.tenantId, day)).not.toBeNull();
    expect(await jobs.retentionTick(a.tenantId, new Date('2031-01-05T23:00:00Z'))).toBeNull();
    expect(await jobs.retentionTick(a.tenantId, new Date('2031-01-06T00:30:00Z'))).not.toBeNull();
  });

  it('hard-purges leads soft-deleted longer than the policy (with their conversations), keeps recent ones', async () => {
    const mk = async (name: string, phone: string) => (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name, phone })).body.id as string;
    const old = await mk('Old Deleted', '+919811000001'); const recent = await mk('Recent Deleted', '+919811000002');
    for (const id of [old, recent]) expect((await ctx.http().delete(`/leads/${id}`).set(auth(a.accessToken))).status).toBe(204);
    await q(`UPDATE leads SET deleted_at = now() - interval '40 days' WHERE id = $1`, [old]);
    await q(`UPDATE leads SET deleted_at = now() - interval '3 days' WHERE id = $1`, [recent]);
    const r = await jobs.runRetention(a.tenantId);
    expect(r.leads).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM leads WHERE id = $1`, [old])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM leads WHERE id = $1`, [recent])).toBe(1);
  });

  it('keeps closed conversations and audit logs unless the owner opts in, then purges old ones (privacy audit entries are never aged out)', async () => {
    const ch = await channel(a);
    const lead = (await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'Convo Lead', phone: '+919811000003' })).body.id as string;
    const conv = (await q(`INSERT INTO conversations (id, tenant_id, channel_id, lead_id, external_thread_id, status, closed_at, last_message_at, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CLOSED', now() - interval '100 days', now() - interval '100 days', now() - interval '100 days') RETURNING id`, [a.tenantId, ch, lead, `lc-${RUN}`])).rows[0].id as string;
    await q(`INSERT INTO messages (id, tenant_id, conversation_id, channel_id, direction, "senderType", type, body, status, created_at) VALUES (gen_random_uuid(), $1, $2, $3, 'INBOUND', 'CUSTOMER', 'TEXT', 'old hello', 'DELIVERED', now() - interval '100 days')`, [a.tenantId, conv, ch]);
    await q(`INSERT INTO audit_logs (id, tenant_id, action, created_at) VALUES (gen_random_uuid(), $1, 'lead.created', now() - interval '400 days'), (gen_random_uuid(), $1, 'privacy.lead_erased', now() - interval '400 days')`, [a.tenantId]);
    await jobs.runRetention(a.tenantId);
    expect(await n(`SELECT count(*)::int n FROM conversations WHERE id = $1`, [conv])).toBe(1); // default: keep
    expect(await n(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id = $1 AND created_at < now() - interval '300 days'`, [a.tenantId])).toBe(2);
    const set = await ctx.http().put('/privacy/retention').set(auth(a.accessToken)).send({ webhookPayloadDays: 30, softDeletedLeadDays: 30, closedConversationDays: 90, auditLogDays: 365 });
    expect(set.status).toBe(200); expect(set.body.settings.closedConversationDays).toBe(90);
    const r = await jobs.runRetention(a.tenantId);
    expect(r.conversations).toBeGreaterThanOrEqual(1); expect(r.messages).toBeGreaterThanOrEqual(1);
    expect(await n(`SELECT count(*)::int n FROM conversations WHERE id = $1`, [conv])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM messages WHERE conversation_id = $1`, [conv])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id = $1 AND action = 'lead.created' AND created_at < now() - interval '300 days'`, [a.tenantId])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id = $1 AND action = 'privacy.lead_erased'`, [a.tenantId])).toBe(1);
  });

  it('enforces the platform minimum and permissions on the settings', async () => {
    const tooShort = await ctx.http().put('/privacy/retention').set(auth(a.accessToken)).send({ webhookPayloadDays: 1, softDeletedLeadDays: 30, closedConversationDays: null, auditLogDays: null });
    expect(tooShort.status).toBe(400);
    const agent = await addMember(ctx, a, 'lcAgent', 'agent');
    expect((await ctx.http().get('/privacy/retention').set(auth(agent.accessToken))).status).toBe(403);
    expect((await ctx.http().put('/privacy/retention').set(auth(agent.accessToken)).send({ webhookPayloadDays: 30, softDeletedLeadDays: 30, closedConversationDays: null, auditLogDays: null })).status).toBe(403);
  });

  it('the application role cannot delete webhook payloads, messages or audit rows directly', async () => {
    const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    for (const t of ['webhook_events', 'messages', 'audit_logs']) await expect(app.query(`DELETE FROM ${t}`), t).rejects.toThrow(/permission denied/);
    await app.end();
  });
});

describe('workspace export', () => {
  it('classifies every tenant table (a new table must be consciously exported or excluded)', async () => {
    const tables = (await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'`)).rows.map((r) => r.table_name as string);
    const classified = new Set([...Object.keys(EXPORT_INCLUDED), ...Object.keys(EXPORT_EXCLUDED)]);
    expect(tables.filter((t) => !classified.has(t)), 'add the table to EXPORT_INCLUDED or EXPORT_EXCLUDED in ops/export-tables.ts').toEqual([]);
    expect(Object.keys(EXPORT_INCLUDED).filter((t) => !tables.includes(t))).toEqual([]);
  });

  it('is built asynchronously, one at a time, owner only; contains the data and none of the secrets; expires', async () => {
    await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'Export Me', phone: '+919822000001' });
    const manager = await addMember(ctx, a, 'lcMgr', 'manager');
    expect((await ctx.http().post('/privacy/exports').set(auth(manager.accessToken)).send({})).status).toBe(403);
    const req = await ctx.http().post('/privacy/exports').set(auth(a.accessToken)).send({});
    expect(req.status).toBe(202);
    expect((await ctx.http().post('/privacy/exports').set(auth(a.accessToken)).send({})).status).toBe(409); // one active export
    expect((await ctx.http().get(`/privacy/exports/${req.body.id}/download`).set(auth(a.accessToken))).status).toBe(404); // not ready yet
    expect(await jobs.processExports()).toBeGreaterThanOrEqual(1);
    const list = (await ctx.http().get('/privacy/exports').set(auth(a.accessToken))).body as { id: string; status: string; sizeBytes: number }[];
    expect(list[0]).toMatchObject({ id: req.body.id, status: 'READY' }); expect(list[0]?.sizeBytes).toBeGreaterThan(100);
    const dl = await ctx.http().get(`/privacy/exports/${req.body.id}/download`).set(auth(a.accessToken)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(dl.status).toBe(200); expect(dl.headers['content-disposition']).toMatch(/attachment/);
    const doc = JSON.parse(gunzipSync(dl.body as Buffer).toString('utf8')) as { tenant: { name: string }; members: { email: string }[]; tables: Record<string, Record<string, unknown>[]> };
    expect(doc.tenant.name).toContain('Biz lcA'); expect(doc.members.map((m) => m.email)).toContain(a.email);
    expect(JSON.stringify(doc.tables.leads)).toContain('Export Me');
    const text = JSON.stringify(doc); expect(text).not.toMatch(/\$argon2|token_hash|webhook_key|passwordHash|password_hash/);
    expect(Object.keys(doc.tables).sort()).toEqual(Object.keys(EXPORT_INCLUDED).sort());
    // tenant isolation: another workspace's owner cannot fetch it
    expect((await ctx.http().get(`/privacy/exports/${req.body.id}/download`).set(auth(b.accessToken))).status).toBe(404);
    // expiry deletes the file and refuses the download
    const key = (await q(`SELECT storage_key FROM data_exports WHERE id = $1`, [req.body.id])).rows[0].storage_key as string;
    await q(`UPDATE data_exports SET expires_at = now() - interval '1 minute' WHERE id = $1`, [req.body.id]);
    expect(await jobs.expireExports()).toBeGreaterThanOrEqual(1);
    await expect(storage.get(key)).rejects.toThrow();
    expect((await ctx.http().get(`/privacy/exports/${req.body.id}/download`).set(auth(a.accessToken))).status).toBe(404);
    expect(await n(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id = $1 AND action IN ('privacy.workspace_export_requested','privacy.workspace_export_ready','privacy.workspace_export_downloaded')`, [a.tenantId])).toBe(3);
  });
});

describe('workspace deletion', () => {
  let t: Account; let other: Account;
  beforeAll(async () => {
    t = await registerAccount(ctx, 'lcDel'); other = await registerAccount(ctx, 'lcKeep');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
  });
  const body = (o: Record<string, unknown> = {}) => ({ reason: 'closing the business', confirm: 'DELETE WORKSPACE', password: PASSWORD, ...o });

  it('needs the owner, the exact phrase, a reason and the password', async () => {
    const manager = await addMember(ctx, t, 'lcDelMgr', 'manager');
    expect((await ctx.http().post('/privacy/workspace/deletion').set(auth(manager.accessToken)).send(body())).status).toBe(403);
    expect((await ctx.http().post('/privacy/workspace/deletion').set(auth(t.accessToken)).send(body({ password: 'Wrong-Passw0rd!x' }))).status).toBe(401);
    expect((await ctx.http().post('/privacy/workspace/deletion').set(auth(t.accessToken)).send(body({ confirm: 'delete' }))).status).toBe(400);
    expect((await ctx.http().post('/privacy/workspace/deletion').set(auth(t.accessToken)).send(body({ reason: 'x' }))).status).toBe(400);
    expect((await ctx.http().get('/privacy/workspace/deletion').set(auth(t.accessToken))).body.pending).toBe(false);
  });

  it('makes the workspace read-only (export and cancel still work) and can be cancelled', async () => {
    const r = await ctx.http().post('/privacy/workspace/deletion').set(auth(t.accessToken)).send(body());
    expect(r.status).toBe(200); expect(r.body.pending).toBe(true);
    const days = (new Date(r.body.purgeAfter).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13); expect(days).toBeLessThanOrEqual(14);
    expect((await ctx.http().post('/privacy/workspace/deletion').set(auth(t.accessToken)).send(body())).status).toBe(409);
    const blocked = await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Blocked', phone: '+919833000001' });
    expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('pending_deletion');
    expect((await ctx.http().get('/leads').set(auth(t.accessToken))).status).toBe(200);
    expect((await ctx.http().post('/privacy/exports').set(auth(t.accessToken)).send({})).status).toBe(202);
    expect((await ctx.http().get('/billing/summary').set(auth(t.accessToken))).body.pendingDeletionAt).toBeTruthy();
    expect((await ctx.http().post('/privacy/workspace/deletion/cancel').set(auth(t.accessToken)).send({})).body.pending).toBe(false);
    expect((await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Allowed again', phone: '+919833000002' })).status).toBe(201);
    expect((await ctx.http().post('/privacy/workspace/deletion/cancel').set(auth(t.accessToken)).send({})).status).toBe(404);
  });

  it('purges every tenant table after the cooling-off period, keeps only invoices/payments and a content-free platform record, and leaves others untouched', async () => {
    const member = await addMember(ctx, t, 'lcDelAgent', 'agent');
    // an account that also belongs to another workspace must survive
    const shared = await registerAccount(ctx, 'lcShared');
    const roleId = (await q(`SELECT id FROM roles WHERE tenant_id = $1 AND key = 'agent'`, [t.tenantId])).rows[0].id as string;
    await q(`INSERT INTO memberships (id, tenant_id, user_id, role_id, status, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', now())`, [t.tenantId, shared.userId, roleId]);
    await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Purge Me', phone: '+919844000001' });
    await ctx.http().post('/leads').set(auth(other.accessToken)).send({ name: 'Keep Me', phone: '+919844000002' });
    await q(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, provider_subscription_id, updated_at) VALUES (gen_random_uuid(), $1, 'growth', 'ACTIVE', 'razorpay', $2, now()) ON CONFLICT (tenant_id) DO UPDATE SET provider='razorpay', provider_subscription_id=$2, status='ACTIVE'`, [t.tenantId, `sub_mock_${RUN}_purge`]);
    await q(`INSERT INTO invoices (id, tenant_id, number, plan_key, description, taxable_minor, cgst_minor, sgst_minor, total_minor, gst_rate_percent, sac, place_of_supply, buyer, seller) VALUES (gen_random_uuid(), $1, $2, 'growth', 'retained for GST', 100, 9, 9, 118, 18, '998314', 'Karnataka', '{}', '{}')`, [t.tenantId, `LC/${RUN}/1`]);
    const objKey = `tenants/${t.tenantId}/knowledge/x/file.txt`; await storage.put(objKey, Buffer.from('secret doc'), 'text/plain');
    const other$ = `tenants/${other.tenantId}/knowledge/x/keep.txt`; await storage.put(other$, Buffer.from('keep'), 'text/plain');

    expect((await ctx.http().post('/privacy/workspace/deletion').set(auth(t.accessToken)).send(body())).status).toBe(200);
    expect(await jobs.purgeDueTenants()).not.toContain(t.tenantId); // cooling-off not over: nothing happens
    expect(await n(`SELECT count(*)::int n FROM tenants WHERE id = $1`, [t.tenantId])).toBe(1);
    await q(`UPDATE tenant_deletion_requests SET purge_after = now() - interval '1 minute' WHERE tenant_id = $1`, [t.tenantId]);

    const mock = ctx.app.get(MockBillingProvider, { strict: false });
    expect(await jobs.purgeDueTenants()).toContain(t.tenantId);

    expect(await n(`SELECT count(*)::int n FROM tenants WHERE id = $1`, [t.tenantId])).toBe(0);
    const tables = (await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'`)).rows.map((r) => r.table_name as string);
    for (const tbl of tables.filter((x) => !RETAINED.includes(x))) expect(await n(`SELECT count(*)::int n FROM "${tbl}" WHERE tenant_id = $1`, [t.tenantId]), `${tbl} must be empty`).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM invoices WHERE tenant_id = $1`, [t.tenantId])).toBe(1); // GST record-keeping
    // accounts: the owner and the agent (only here) are gone, the shared account survives
    for (const u of [t.userId, member.userId]) expect(await n(`SELECT count(*)::int n FROM users WHERE id = $1`, [u])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM users WHERE id = $1`, [shared.userId])).toBe(1);
    expect((await ctx.http().post('/auth/login').send({ email: t.email, password: PASSWORD })).status).toBe(401);
    // files, provider, other workspace
    await expect(storage.get(objKey)).rejects.toThrow(); expect((await storage.get(other$)).toString()).toBe('keep');
    expect(mock.calls.some((c) => c.op === 'cancelSubscription' && (c.args as { id: string }).id === `sub_mock_${RUN}_purge`)).toBe(true);
    expect((await ctx.http().get('/leads').set(auth(other.accessToken))).body.total).toBe(1);
    // the only trace besides invoices: a content-free platform audit record
    const rec = (await q(`SELECT action, reason, metadata FROM platform_audit_logs WHERE tenant_id = $1`, [t.tenantId])).rows;
    expect(rec).toHaveLength(1); expect(rec[0].action).toBe('platform.tenant_purged'); expect(JSON.stringify(rec[0])).not.toMatch(/Purge Me|closing the business/);
    expect(await jobs.purgeDueTenants()).not.toContain(t.tenantId); // idempotent
    await storage.delete(other$);
  });

  it('purge_tenant reports exactly the documented retained tables (a new table cannot be silently kept)', async () => {
    const scratch = (await q(`INSERT INTO tenants (id, name, email, industry, updated_at) VALUES (gen_random_uuid(), 'Scratch', 'scratch@example.test', 'other', now()) RETURNING id`)).rows[0].id as string;
    const r = (await q(`SELECT purge_tenant($1) AS r`, [scratch])).rows[0].r as { retained: string[]; tables: Record<string, number> };
    expect([...r.retained].sort()).toEqual([...RETAINED].sort());
    const tables = (await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'`)).rows.map((x) => x.table_name as string);
    expect(tables.filter((x) => !RETAINED.includes(x) && !(x in r.tables))).toEqual([]);
  });

  it('shows pending deletions in the platform console', async () => {
    const pending = await registerAccount(ctx, 'lcPending');
    await ctx.http().post('/privacy/workspace/deletion').set(auth(pending.accessToken)).send(body());
    const email = `it-${RUN}-lcadmin@example.test`;
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await q(`INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'LC Admin')`, [email, hash]);
    const login = await ctx.http().post('/platform/auth/login').send({ email, password: PASSWORD });
    const token = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform='))?.split(';')[0]?.split('=')[1] ?? '';
    expect((await ctx.http().get('/platform/deletion-requests').set(auth(pending.accessToken))).status).toBe(401);
    const list = await ctx.http().get('/platform/deletion-requests').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect((list.body as { tenantId: string }[]).some((r) => r.tenantId === pending.tenantId)).toBe(true);
  });
});
