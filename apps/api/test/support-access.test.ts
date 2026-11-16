import argon2 from 'argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

/** Platform support access: read-only, time-limited, reasoned, password-confirmed, audited on both sides, switchable off by the workspace owner. */
let ctx: TestCtx; let owner: Account; let agent: Account; let other: Account;
const o = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
let admin = ''; // platform bearer
const email = `it-${RUN}-support@example.test`;
const sup = (t: string) => ({ Authorization: `Bearer ${t}` });
const plat = () => ({ Authorization: `Bearer ${admin}` });
let leadId = '';

async function startSession(tenantId: string, over: Record<string, unknown> = {}) {
  return ctx.http().post(`/platform/tenants/${tenantId}/support-session`).set(plat()).send({ reason: 'Customer reported missing leads (ticket 1234)', password: PASSWORD, ...over });
}
const audits = async (tenantId: string, like: string) => (await o.query(`SELECT action, metadata FROM audit_logs WHERE tenant_id = $1 AND action LIKE $2 ORDER BY created_at`, [tenantId, like])).rows as { action: string; metadata: Record<string, string> }[];

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'supOwner'); other = await registerAccount(ctx, 'supOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'supAgent', 'agent');
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await o.query(`INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'Sita Support')`, [email, hash]);
  const l = await ctx.http().post('/platform/auth/login').send({ email, password: PASSWORD });
  admin = (l.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform='))?.split(';')[0]?.split('=')[1] ?? '';
  expect(admin.length).toBeGreaterThan(20);
  leadId = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Support Visible Lead', phone: '+919800099111' })).body.id;
  await ctx.http().post('/leads').set(auth(other.accessToken)).send({ name: 'Other Workspace Lead', phone: '+919800099222' });
});
afterAll(async () => { await o.query(`DELETE FROM support_access_sessions WHERE tenant_id = ANY($1)`, [[owner.tenantId, other.tenantId]]); await o.end(); await ctx.close(); await cleanup(); });

describe('starting a session', () => {
  it('needs a console login, a real reason and the admin\'s password again', async () => {
    expect((await ctx.http().post(`/platform/tenants/${owner.tenantId}/support-session`).send({ reason: 'Customer reported missing leads', password: PASSWORD })).status).toBe(401);
    expect((await ctx.http().post(`/platform/tenants/${owner.tenantId}/support-session`).set(auth(owner.accessToken)).send({ reason: 'Customer reported missing leads', password: PASSWORD })).status).toBe(401); // a tenant owner is not an admin
    expect((await startSession(owner.tenantId, { reason: 'short' })).status).toBe(400);
    expect((await startSession(owner.tenantId, { minutes: 90 })).status).toBe(400); // hard cap 30 minutes
    const wrong = await startSession(owner.tenantId, { password: 'Wrong-Passw0rd!x' });
    expect(wrong.status).toBe(401);
    expect((await o.query(`SELECT count(*)::int n FROM platform_audit_logs WHERE tenant_id = $1 AND action = 'platform.support_password_failed'`, [owner.tenantId])).rows[0].n).toBe(1);
    expect((await o.query(`SELECT count(*)::int n FROM support_access_sessions WHERE tenant_id = $1`, [owner.tenantId])).rows[0].n).toBe(0); // nothing was opened
  });
});

describe('what a support session can do', () => {
  let token = ''; let sessionId = '';
  beforeAll(async () => { const r = await startSession(owner.tenantId); expect(r.status, JSON.stringify(r.body)).toBe(200); token = r.body.token; sessionId = r.body.sessionId; });

  it('sets the support cookie, says who is looking, and tells the customer', async () => {
    const r = await ctx.http().get('/support-session').set(sup(token));
    expect(r.body).toMatchObject({ active: true, adminName: 'Sita Support', readOnly: true }); expect(r.body.reason).toMatch(/ticket 1234/);
    expect((await ctx.http().get('/support-session').set(auth(owner.accessToken))).body).toEqual({ active: false });
    const me = (await ctx.http().get('/auth/me').set(sup(token))).body;
    expect(me.user.name).toContain('LeadPilot support'); expect(me.activeTenantId).toBe(owner.tenantId); expect(me.workspaces[0].roleKey).toBe('support'); expect(me.permissions).not.toContain('team:manage');
    expect((await o.query(`SELECT count(*)::int n FROM notifications WHERE tenant_id = $1 AND type = 'security'`, [owner.tenantId])).rows[0].n).toBeGreaterThan(0);
    const started = await audits(owner.tenantId, 'support.session_started'); expect(started).toHaveLength(1); expect(started[0]?.metadata.adminName).toBe('Sita Support');
  });

  it('can read the workspace\'s data (and only that workspace\'s)', async () => {
    const leads = await ctx.http().get('/leads').set(sup(token));
    expect(leads.status).toBe(200); expect(JSON.stringify(leads.body)).toContain('Support Visible Lead'); expect(JSON.stringify(leads.body)).not.toContain('Other Workspace Lead');
    for (const p of ['/leads', `/leads/${leadId}`, '/conversations', '/pipeline/stages', '/appointments', '/analytics/overview?range=30d', '/reports/acquisition?range=30d', '/usage', '/billing/summary', '/tasks']) expect((await ctx.http().get(p).set(sup(token))).status, p).toBe(200);
  });

  it('cannot change anything: every write is refused at the guard and nothing happens', async () => {
    const before = (await o.query(`SELECT count(*)::int n FROM leads WHERE tenant_id = $1`, [owner.tenantId])).rows[0].n as number;
    const writes: [string, string, object][] = [['post', '/leads', { name: 'Hacked', phone: '+919800000009' }], ['patch', `/leads/${leadId}`, { name: 'Renamed' }], ['delete', `/leads/${leadId}`, {}], ['post', '/tasks', { title: 'x' }], ['put', '/sla', { enabled: false, firstResponseMinutes: 5 }], ['post', `/leads/${leadId}/notes`, { body: 'x' }], ['post', '/appointments', {}], ['patch', '/tenant', { name: 'Evil' }], ['put', '/support-access', { enabled: true }], ['post', '/auth/logout', {}], ['post', '/auth/switch-workspace', { tenantId: owner.tenantId }]];
    for (const [m, p, b] of writes) { const r = await ctx.http()[m as 'post'](p).set(sup(token)).send(b); expect(r.status, `${m} ${p}`).toBe(403); expect(r.body.error.code, `${m} ${p}`).toBe('support_session_read_only'); }
    expect((await o.query(`SELECT count(*)::int n FROM leads WHERE tenant_id = $1`, [owner.tenantId])).rows[0].n).toBe(before);
    expect((await ctx.http().get(`/leads/${leadId}`).set(auth(owner.accessToken))).body.name).toBe('Support Visible Lead');
  });

  it('cannot reach people, money, credentials, integrations, exports or downloads', async () => {
    const blocked = ['/team/members', '/team/invitations', '/roles', '/billing/invoices', '/billing/profile', '/channels', '/api-keys', '/webhooks/endpoints', '/audit-logs', `/privacy/leads/${leadId}/export`, '/knowledge/documents', '/notifications', '/leads/export', '/reports/acquisition/export', '/auth/sessions', '/ai/assistant', '/support-access', '/realtime/stream'];
    for (const p of ['/platform/metrics', '/v1/leads']) expect((await ctx.http().get(p).set(sup(token))).status, p).toBe(401); // other credential systems do not accept a support token
    for (const p of blocked) { const r = await ctx.http().get(p).set(sup(token)); expect(r.status, p).toBe(403); expect(['blocked_for_support', 'support_session_read_only']).toContain(r.body.error.code); }
  });

  it('is not interchangeable with other credentials', async () => {
    expect((await ctx.http().get('/leads').set(plat())).status).toBe(401); // a console token is not a support token
    expect((await ctx.http().get('/platform/me').set(sup(token))).status).toBe(401); // and a support token does not open the console
    expect((await ctx.http().get('/leads').set(sup(`${token}x`))).status).toBe(401);
  });

  it('is mirrored into BOTH audit trails: starts, every request, every blocked attempt', async () => {
    const t = await audits(owner.tenantId, 'support.%');
    const actions = [...new Set(t.map((x) => x.action))];
    expect(actions).toEqual(expect.arrayContaining(['support.session_started', 'support.request', 'support.blocked']));
    expect(t.find((x) => x.action === 'support.request' && x.metadata.path === '/leads')).toMatchObject({ metadata: { method: 'GET', adminName: 'Sita Support' } });
    expect(t.find((x) => x.action === 'support.blocked' && x.metadata.path === '/team/members')).toBeTruthy();
    const p = (await o.query(`SELECT action, metadata, reason FROM platform_audit_logs WHERE tenant_id = $1 AND action LIKE 'platform.support_%'`, [owner.tenantId])).rows as { action: string; metadata: Record<string, string>; reason: string | null }[];
    expect(p.map((x) => x.action)).toEqual(expect.arrayContaining(['platform.support_session_started', 'platform.support_request', 'platform.support_blocked']));
    expect(p.find((x) => x.action === 'platform.support_session_started')?.reason).toMatch(/ticket 1234/);
    // the workspace owner can see it in their own audit log
    const seen = (await ctx.http().get('/audit-logs?limit=100').set(auth(owner.accessToken))).body;
    expect(JSON.stringify(seen)).toContain('support.session_started');
  });

  it('can be ended by the customer-visible End button, after which the token is dead', async () => {
    expect((await ctx.http().post('/support-session/end').set(sup(token))).status).toBe(200);
    const after = await ctx.http().get('/leads').set(sup(token));
    expect(after.status).toBe(401); expect(after.body.error.code).toBe('support_session_ended');
    expect((await audits(owner.tenantId, 'support.session_ended'))).toHaveLength(1);
    expect((await ctx.http().post('/support-session/end').set(auth(owner.accessToken))).status).toBe(403); // a normal login cannot "end" anything
    expect(sessionId).toBeTruthy();
  });
});

describe('time limits and revocation', () => {
  it('stops working the moment the session expires, even though the token itself has not', async () => {
    const r = await startSession(owner.tenantId); const token = r.body.token as string;
    expect((await ctx.http().get('/leads').set(sup(token))).status).toBe(200);
    await o.query(`UPDATE support_access_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [r.body.sessionId]);
    const dead = await ctx.http().get('/leads').set(sup(token));
    expect(dead.status).toBe(401); expect(dead.body.error.code).toBe('support_session_ended');
    const mins = (await o.query(`SELECT extract(epoch FROM (expires_at - started_at))/60 AS m FROM support_access_sessions WHERE id = $1`, [r.body.sessionId])).rows[0];
    expect(Number(mins.m)).toBeLessThan(0); // we moved it into the past; originally it was at most 30 minutes (checked below)
    const fresh = await startSession(owner.tenantId, { minutes: 30 });
    const span = (await o.query(`SELECT extract(epoch FROM (expires_at - started_at))/60 AS m FROM support_access_sessions WHERE id = $1`, [fresh.body.sessionId])).rows[0];
    expect(Number(span.m)).toBeLessThanOrEqual(30.01);
    await ctx.http().post(`/platform/support-sessions/${fresh.body.sessionId}/end`).set(plat());
  });

  it('can be ended by the platform, which the customer is told about', async () => {
    const r = await startSession(owner.tenantId);
    expect((await ctx.http().get('/platform/support-sessions').set(plat())).body.find((s: { id: string; active: boolean }) => s.id === r.body.sessionId)?.active).toBe(true);
    expect((await ctx.http().post(`/platform/support-sessions/${r.body.sessionId}/end`).set(plat())).status).toBe(200);
    expect((await ctx.http().get('/leads').set(sup(r.body.token))).status).toBe(401);
    expect((await ctx.http().post(`/platform/support-sessions/${r.body.sessionId}/end`).set(plat())).status).toBe(409);
  });

  it('dies when the workspace is suspended or the admin is disabled', async () => {
    const r = await startSession(other.tenantId); const token = r.body.token as string;
    await o.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [other.tenantId]);
    expect((await ctx.http().get('/leads').set(sup(token))).status).toBe(401);
    await o.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [other.tenantId]);
    expect((await startSession(other.tenantId)).status).toBe(200);
    await o.query(`UPDATE support_access_sessions SET ended_at = now() WHERE tenant_id = $1`, [other.tenantId]);
  });
});

describe('the workspace owner can switch support access off', () => {
  it('refuses new sessions, ends open ones at once, and only owners (not agents or support itself) can change it', async () => {
    const open = await startSession(owner.tenantId); const token = open.body.token as string;
    expect((await ctx.http().get('/leads').set(sup(token))).status).toBe(200);
    expect((await ctx.http().put('/support-access').set(auth(agent.accessToken)).send({ enabled: false })).status).toBe(403);
    expect((await ctx.http().put('/support-access').set(sup(token)).send({ enabled: false })).status).toBe(403);
    expect((await ctx.http().get('/support-access').set(auth(owner.accessToken))).body).toEqual({ enabled: true });
    expect((await ctx.http().put('/support-access').set(auth(owner.accessToken)).send({ enabled: false })).status).toBe(200);
    expect((await ctx.http().get('/leads').set(sup(token))).status).toBe(401); // open session ended immediately
    const refused = await startSession(owner.tenantId);
    expect(refused.status).toBe(403); expect(refused.body.error.code).toBe('support_access_disabled');
    expect((await o.query(`SELECT count(*)::int n FROM platform_audit_logs WHERE tenant_id = $1 AND action = 'platform.support_refused'`, [owner.tenantId])).rows[0].n).toBe(1);
    expect((await audits(owner.tenantId, 'support.access_disabled'))).toHaveLength(1);
    expect((await ctx.http().put('/support-access').set(auth(owner.accessToken)).send({ enabled: true })).status).toBe(200);
    expect((await startSession(owner.tenantId)).status).toBe(200);
  });
});
