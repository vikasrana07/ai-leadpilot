import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import pg from 'pg';
import { addMember, auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, WEB_ORIGIN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const owner = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
let tenant: Account; let tenant2: Account;
let token = ''; let adminId = '';
const email = `it-${RUN}-padmin@example.test`;
const P = '/platform';
const bearer = () => ({ Authorization: `Bearer ${token}` });
const planBody = (key: string, seats = 4) => ({
  key, name: `Test ${key}`, description: 'test', priceMinor: 123400, trialDays: 7, isPublic: false, active: true, sortOrder: 500,
  entitlements: [
    ...['seats', 'ai_tokens_monthly', 'whatsapp_messages_monthly', 'active_automations', 'knowledge_mb'].map((k) => ({ key: k, enabled: true, limit: k === 'seats' ? seats : 1000 })),
    ...['ai_assistant', 'automations', 'web_widget', 'csv_export', 'api_access', 'lead_portal'].map((k) => ({ key: k, enabled: true, limit: null })),
  ],
});

beforeAll(async () => {
  ctx = await createTestApp();
  tenant = await registerAccount(ctx, 'platT1');
  tenant2 = await registerAccount(ctx, 'platT2');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', tenant.email)?.token });
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const r = await owner.query("INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'Test Admin') RETURNING id", [email, hash]);
  adminId = r.rows[0].id as string;
  const login = await ctx.http().post(`${P}/auth/login`).send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  token = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform='))?.split(';')[0]?.split('=')[1] ?? '';
  expect(token.length).toBeGreaterThan(20);
});
afterAll(async () => { await ctx.close(); await cleanup(); await owner.end(); });

describe('platform authentication', () => {
  it('gives the same error for a wrong password and an unknown admin, and sets a strict httpOnly cookie', async () => {
    const wrong = await ctx.http().post(`${P}/auth/login`).send({ email, password: 'Wrong-Passw0rd!x' });
    const unknown = await ctx.http().post(`${P}/auth/login`).send({ email: `nobody-${RUN}@example.test`, password: 'Wrong-Passw0rd!x' });
    expect(wrong.status).toBe(401); expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const ok = await ctx.http().post(`${P}/auth/login`).send({ email, password: PASSWORD });
    const cookie = (ok.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform=')) ?? '';
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('rejects tenant tokens on the console and console tokens on tenant routes (separate audiences)', async () => {
    expect((await ctx.http().get(`${P}/me`).set(auth(tenant.accessToken))).status).toBe(401);
    expect((await ctx.http().get(`${P}/metrics`)).status).toBe(401);
    expect((await ctx.http().get('/leads').set(bearer())).status).toBe(401);
    expect((await ctx.http().get(`${P}/me`).set(bearer())).body.admin.email).toBe(email);
  });

  it('blocks cookie-authenticated cross-site writes (CSRF)', async () => {
    const bad = await ctx.http().post(`${P}/tenants/${tenant.tenantId}/suspend`).set('Cookie', `lp_platform=${token}`).set('Origin', 'https://evil.example').send({ reason: 'csrf attempt' });
    expect(bad.status).toBe(403);
    const good = await ctx.http().get(`${P}/me`).set('Cookie', `lp_platform=${token}`).set('Origin', WEB_ORIGIN);
    expect(good.status).toBe(200);
  });

  it('locks an admin after repeated failures even for the right password, and a disabled admin loses access immediately', async () => {
    const e2 = `it-${RUN}-padmin2@example.test`;
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await owner.query("INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'Second')", [e2, hash]);
    for (let i = 0; i < 5; i++) expect((await ctx.http().post(`${P}/auth/login`).send({ email: e2, password: 'Nope-Passw0rd!x' })).status).toBe(401);
    expect((await ctx.http().post(`${P}/auth/login`).send({ email: e2, password: PASSWORD })).status).toBe(401);
    // disabling revokes an already-issued token on the very next call
    await owner.query("UPDATE platform_admins SET status='ACTIVE', locked_until=NULL WHERE email=$1", [e2]);
    const l = await ctx.http().post(`${P}/auth/login`).send({ email: e2, password: PASSWORD });
    const t2 = (l.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform='))?.split(';')[0]?.split('=')[1] ?? '';
    expect((await ctx.http().get(`${P}/me`).set('Authorization', `Bearer ${t2}`)).status).toBe(200);
    await owner.query("UPDATE platform_admins SET status='DISABLED' WHERE email=$1", [e2]);
    expect((await ctx.http().get(`${P}/me`).set('Authorization', `Bearer ${t2}`)).status).toBe(401);
  });
});

describe('overview', () => {
  it('shows platform metrics and finds tenants by name, with usage', async () => {
    const m = await ctx.http().get(`${P}/metrics`).set(bearer());
    expect(m.status).toBe(200);
    expect(m.body.tenants.total).toBeGreaterThanOrEqual(2); expect(typeof m.body.mrrMinor).toBe('number');
    const list = await ctx.http().get(`${P}/tenants`).query({ search: `Biz platT1 ${RUN}` }).set(bearer());
    expect(list.body).toHaveLength(1); expect(list.body[0].id).toBe(tenant.tenantId);
    const d = await ctx.http().get(`${P}/tenants/${tenant.tenantId}`).set(bearer());
    expect(d.status).toBe(200); expect(d.body.owners[0].email).toBe(tenant.email); expect(d.body.usage.seats).toBe(1);
    expect((await ctx.http().get(`${P}/tenants/00000000-0000-4000-8000-000000000000`).set(bearer())).status).toBe(404);
    expect((await ctx.http().get(`${P}/tenants/not-a-uuid`).set(bearer())).status).toBe(400);
  });

  it('MRR counts paying subscriptions only (complimentary plans do not count)', async () => {
    const before = (await ctx.http().get(`${P}/metrics`).set(bearer())).body.mrrMinor as number;
    await owner.query("INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, provider_subscription_id, updated_at) VALUES (gen_random_uuid(), $1, 'growth', 'ACTIVE', 'razorpay', $2, now()) ON CONFLICT (tenant_id) DO UPDATE SET plan_key='growth', status='ACTIVE', provider='razorpay'", [tenant2.tenantId, `sub_mock_${RUN}_mrr`]);
    await owner.query("UPDATE tenants SET plan_key='growth' WHERE id=$1", [tenant2.tenantId]);
    const after = (await ctx.http().get(`${P}/metrics`).set(bearer())).body.mrrMinor as number;
    expect(after - before).toBe(999900);
  });
});

describe('tenant actions are reasoned and audited on both sides', () => {
  it('suspending needs a reason, locks the workspace out, and reactivating restores it', async () => {
    expect((await ctx.http().post(`${P}/tenants/${tenant2.tenantId}/suspend`).set(bearer()).send({})).status).toBe(400);
    expect((await ctx.http().post(`${P}/tenants/${tenant2.tenantId}/suspend`).set(bearer()).send({ reason: 'abuse report 123' })).status).toBe(200);
    expect((await ctx.http().get('/leads').set(auth(tenant2.accessToken))).status).toBe(403);
    expect((await ctx.http().post(`${P}/tenants/${tenant2.tenantId}/reactivate`).set(bearer()).send({ reason: 'resolved with customer' })).status).toBe(200);
    expect((await ctx.http().get('/leads').set(auth(tenant2.accessToken))).status).toBe(200);
    const tenantSide = await owner.query("SELECT action, metadata FROM audit_logs WHERE tenant_id=$1 AND action LIKE 'platform.%' ORDER BY created_at", [tenant2.tenantId]);
    expect(tenantSide.rows.map((r) => r.action)).toEqual(['platform.tenant_suspended', 'platform.tenant_reactivated']);
    expect(tenantSide.rows[0].metadata.reason).toBe('abuse report 123'); expect(tenantSide.rows[0].metadata.byPlatformAdmin).toBe(adminId);
    const log = (await ctx.http().get(`${P}/audit`).set(bearer())).body as { action: string; reason: string }[];
    expect(log.some((l) => l.action === 'platform.tenant_suspended' && l.reason === 'abuse report 123')).toBe(true);
  });

  it('can grant a complimentary plan or an extended trial, but not over a live paid subscription', async () => {
    const r = await ctx.http().post(`${P}/tenants/${tenant.tenantId}/plan`).set(bearer()).send({ planKey: 'premium', mode: 'complimentary', days: 30, reason: 'design partner' });
    expect(r.status).toBe(200);
    const s = (await ctx.http().get('/billing/summary').set(auth(tenant.accessToken))).body;
    expect(s.planKey).toBe('premium'); expect(s.status).toBe('ACTIVE'); expect(s.limits.seats).toBe(30);
    const t = await ctx.http().post(`${P}/tenants/${tenant.tenantId}/plan`).set(bearer()).send({ planKey: 'growth', mode: 'trial', days: 21, reason: 'extended evaluation' });
    expect(t.status).toBe(200);
    expect((await ctx.http().get('/billing/summary').set(auth(tenant.accessToken))).body.status).toBe('TRIALING');
    expect((await ctx.http().post(`${P}/tenants/${tenant.tenantId}/plan`).set(bearer()).send({ planKey: 'growth', mode: 'trial', reason: 'x' })).status).toBe(400);
    const paid = await ctx.http().post(`${P}/tenants/${tenant2.tenantId}/plan`).set(bearer()).send({ planKey: 'starter', mode: 'complimentary', reason: 'trying to override' });
    expect(paid.status).toBe(409); expect(paid.body.error.code).toBe('has_paid_subscription');
  });

  it('is unreachable to ordinary tenant users', async () => {
    expect((await ctx.http().get(`${P}/tenants`).set(auth(tenant.accessToken))).status).toBe(401);
    expect((await ctx.http().post(`${P}/tenants/${tenant.tenantId}/suspend`).set(auth(tenant.accessToken)).send({ reason: 'nope nope' })).status).toBe(401);
  });
});

describe('platform data is invisible from any tenant context', () => {
  it('hides the platform audit log from tenant-scoped transactions, even for a tenant it mentions', async () => {
    const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const client = await app.connect();
    try {
      const total = (await owner.query('SELECT count(*)::int n FROM platform_audit_logs WHERE tenant_id = $1', [tenant2.tenantId])).rows[0].n as number;
      expect(total).toBeGreaterThan(0);
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant2.tenantId]);
      expect((await client.query('SELECT count(*)::int n FROM platform_audit_logs')).rows[0].n).toBe(0);
      await expect(client.query("INSERT INTO platform_audit_logs (id, action) VALUES (gen_random_uuid(), 'forged')")).rejects.toThrow(/row-level security/);
      await client.query('ROLLBACK');
    } finally { client.release(); await app.end(); }
  });
});

describe('plans are data, editable by platform admins', () => {
  const key = `it_${RUN.slice(0, 4)}_p1`;
  it('validates the entitlement set and the key format', async () => {
    const missing = { ...planBody(key), entitlements: planBody(key).entitlements.slice(1) };
    expect((await ctx.http().post(`${P}/plans`).set(bearer()).send(missing)).status).toBe(400);
    expect((await ctx.http().post(`${P}/plans`).set(bearer()).send(planBody('Bad Key!'))).status).toBe(400);
  });

  it('creates a plan, rejects duplicates, and a limit change reaches live customers at once', async () => {
    const c = await ctx.http().post(`${P}/plans`).set(bearer()).send(planBody(key, 2));
    expect(c.status).toBe(201); expect(c.body.priceWithGstMinor).toBe(Math.round(123400 * 1.18));
    expect((await ctx.http().post(`${P}/plans`).set(bearer()).send(planBody(key))).status).toBe(409);
    await owner.query("INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, provider_subscription_id, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', 'razorpay', $3, now()) ON CONFLICT (tenant_id) DO UPDATE SET plan_key=$2, status='ACTIVE', provider='razorpay', provider_subscription_id=$3", [tenant.tenantId, key, `sub_mock_${RUN}_plan`]);
    await owner.query('UPDATE tenants SET plan_key=$2 WHERE id=$1', [tenant.tenantId, key]);
    await addMember(ctx, tenant, 'platT1m', 'agent'); // seat 2 of 2
    const full = await ctx.http().post('/team/invitations').set(auth(tenant.accessToken)).send({ email: `it-${RUN}-platfull@example.test`, roleKey: 'agent' });
    expect(full.status).toBe(402);
    const up = await ctx.http().patch(`${P}/plans/${key}`).set(bearer()).send({ entitlements: planBody(key, 5).entitlements });
    expect(up.status).toBe(200);
    expect((await ctx.http().post('/team/invitations').set(auth(tenant.accessToken)).send({ email: `it-${RUN}-platfull@example.test`, roleKey: 'agent' })).status).toBe(201);
  });

  it('reports how many workspaces are on each plan', async () => {
    // Self-contained: new workspaces sign up on the configured SIGNUP_PLAN ('internal' by default). Do not rely on tenants left in a developer's database.
    const before = ((await ctx.http().get(`${P}/plans`).set(bearer())).body as { key: string; tenants: number }[]).find((p) => p.key === 'internal')?.tenants ?? 0;
    await registerAccount(ctx, 'planCountA');
    await registerAccount(ctx, 'planCountB');
    const plans = (await ctx.http().get(`${P}/plans`).set(bearer())).body as { key: string; tenants: number }[];
    expect(plans.find((p) => p.key === 'internal')?.tenants).toBe(before + 2);
  });

  it('protects the internal plan from being switched off', async () => {
    expect((await ctx.http().patch(`${P}/plans/internal`).set(bearer()).send({ active: false })).status).toBe(400);
    expect((await ctx.http().patch(`${P}/plans/nope_plan`).set(bearer()).send({ name: 'xx' })).status).toBe(404);
  });

  it('records plan edits in the platform audit log', async () => {
    const log = (await ctx.http().get(`${P}/audit`).set(bearer())).body as { action: string; targetId: string }[];
    expect(log.some((l) => l.action === 'platform.plan_created' && l.targetId === key)).toBe(true);
    expect(log.some((l) => l.action === 'platform.plan_updated' && l.targetId === key)).toBe(true);
  });
});
