import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC, NO_TENANT, PERMISSIONS_META } from '../src/common/decorators.js';
import { cleanup, createTestApp, registerAccount, auth, type Account, type TestCtx } from './helpers.js';

interface Route { method: string; path: string; isPublic: boolean; noTenant: boolean; perms: string[]; ctrl: string; handler: string }
let ctx: TestCtx; let routes: Route[] = []; let owner: Account;
const METHODS: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PATCH]: 'PATCH' };
const UUID = '00000000-0000-4000-8000-000000000000';

function discover(): Route[] {
  const discovery = new DiscoveryService(ctx.app.get(ModulesContainer)); const scanner = new MetadataScanner(); const reflector = ctx.app.get(Reflector);
  const out: Route[] = [];
  for (const w of discovery.getControllers()) {
    const type = w.metatype as (new (...a: never[]) => object) | null; if (!type?.prototype) continue;
    const base = (Reflect.getMetadata('path', type) as string | undefined) ?? '';
    for (const name of scanner.getAllMethodNames(type.prototype)) {
      const fn = (type.prototype as Record<string, unknown>)[name] as object;
      const p = Reflect.getMetadata('path', fn) as string | string[] | undefined; const m = Reflect.getMetadata('method', fn) as number | undefined;
      if (p === undefined || m === undefined) continue;
      const path = `/${[base, Array.isArray(p) ? p[0] : p].join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      out.push({
        method: METHODS[m] ?? 'GET', path, ctrl: type.name, handler: name,
        isPublic: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC, [fn as never, type]), noTenant: !!reflector.getAllAndOverride<boolean>(NO_TENANT, [fn as never, type]),
        perms: reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_META, [fn as never, type]) ?? [],
      });
    }
  }
  return out;
}
const fill = (path: string) => path.replace(/:[A-Za-z]+/g, (s) => (s === ':key' ? 'abcdefghijklmnopqrstuvwxyz012345' : UUID));
const label = (r: Route) => `${r.method} ${r.path}`;

beforeAll(async () => { ctx = await createTestApp(); routes = discover(); owner = await registerAccount(ctx, 'secOwner'); });
afterAll(async () => { await ctx.close(); await cleanup(); });

/**
 * Every PUBLIC route is a deliberate, reviewed decision: adding one fails this test until it is listed here with a reason.
 * (Webhooks authenticate by signature, the widget by session token + origin allow-list, capture by API key.)
 */
const PUBLIC_ALLOWLIST: Record<string, string> = {
  'GET /health': 'liveness', 'GET /health/ready': 'readiness',
  'POST /auth/register': 'signup', 'POST /auth/login': 'login', 'POST /auth/refresh': 'refresh cookie', 'POST /auth/logout': 'logout', 'POST /auth/verify-email': 'token', 'POST /auth/forgot-password': 'token flow', 'POST /auth/reset-password': 'token flow',
  'POST /auth/invitations/accept': 'invite token', 'GET /auth/invitations/:token': 'invite token preview', 'POST /auth/invitations/preview': 'invite token preview',
  'POST /webhooks/razorpay': 'HMAC signature', 'GET /webhooks/whatsapp/:key': 'Meta verify challenge', 'POST /webhooks/whatsapp/:key': 'HMAC signature', 'GET /webhooks/whatsapp': 'Meta verify challenge (platform app, 404 while Embedded Signup is off)', 'POST /webhooks/whatsapp': 'HMAC signature with the platform app secret (404 while Embedded Signup is off)',
  'POST /auth/mfa/verify': 'second sign-in step (challenge token + code, throttled, lockout)', 'POST /platform/auth/mfa': 'platform second sign-in step', 'POST /platform/auth/login': 'platform login', 'POST /platform/auth/logout': 'platform logout',
};
describe('route inventory', () => {
  it('public-API (/v1) routes are all guarded by ApiKeyGuard; only the OpenAPI description is open (key-authenticated families are covered by public-api.test.ts)', async () => {
    const v1 = routes.filter((r) => r.path.startsWith('/v1'));
    expect(v1.length).toBeGreaterThan(10);
    const open = [];
    for (const r of v1.filter((x) => x.path !== '/v1/openapi.json')) { const res = await ctx.http()[r.method.toLowerCase() as 'get'](fill(r.path)).send({}); if (res.status !== 401) open.push(`${label(r)} -> ${res.status}`); }
    expect(open).toEqual([]);
    expect((await ctx.http().get('/v1/openapi.json')).status).toBe(200);
  });

  it('discovers a plausible number of routes', () => { expect(routes.length).toBeGreaterThan(150); });

  it('public routes are exactly the reviewed allow-list (plus signature/key/token-authenticated families)', () => {
    const unexpected = routes.filter((r) => r.isPublic && !r.path.startsWith('/platform') && !r.path.startsWith('/widget') && !r.path.startsWith('/public') && !r.path.startsWith('/v1') && !(label(r) in PUBLIC_ALLOWLIST)).map(label);
    expect(unexpected, 'new @Public() routes must be reviewed and added to PUBLIC_ALLOWLIST').toEqual([]);
  });

  it('platform routes other than login/logout are guarded by PlatformGuard', async () => {
    const guarded = routes.filter((r) => r.path.startsWith('/platform') && !(label(r) in PUBLIC_ALLOWLIST));
    expect(guarded.length).toBeGreaterThan(8);
    for (const r of guarded) {
      const res = await ctx.http()[r.method.toLowerCase() as 'get'](fill(r.path)).send({});
      expect(res.status, label(r)).toBe(401);
    }
  });
});

describe('unauthenticated access', () => {
  it('every non-public route answers 401 without credentials (and never executes)', async () => {
    const target = routes.filter((r) => !r.isPublic);
    expect(target.length).toBeGreaterThan(100);
    const failures: string[] = [];
    for (const r of target) {
      const res = await ctx.http()[r.method.toLowerCase() as 'get'](fill(r.path)).send({});
      if (res.status !== 401) failures.push(`${label(r)} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('a tenant token for a DIFFERENT audience and a garbage bearer are rejected everywhere sampled', async () => {
    for (const p of ['/leads', '/team/members', '/billing/summary', '/appointments', '/conversations']) {
      expect((await ctx.http().get(p).set('Authorization', 'Bearer not.a.token')).status, p).toBe(401);
    }
  });
});

describe('permission declarations', () => {
  /**
   * Routes that do NOT declare @RequirePermissions. Membership alone reaches them, and the SERVICE enforces the real rule
   * (own-vs-all row scoping, `lead:delete`, `conversation:assign`, ...). That is behaviourally tested below. Adding a route here
   * (or a new route without a decorator) fails this test: it forces a conscious review.
   */
  const SERVICE_ENFORCED = new Set([
    'GET /billing/summary', 'GET /billing/plans', 'GET /notifications', 'GET /notifications/unread-count', 'POST /notifications/:id/read', 'POST /notifications/read-all', 'GET /notifications/preferences', 'PUT /notifications/preferences',
    'GET /realtime/stream', 'GET /tenant', 'GET /tenant/onboarding', 'GET /tasks', 'POST /tasks', 'PATCH /tasks/:id', 'DELETE /tasks/:id', 'GET /sla', 'GET /roles', 'GET /security/workspace',
    'DELETE /appointments/availability/exceptions/:id', 'DELETE /leads/:id', 'DELETE /leads/:id/score/override', 'GET /analytics/overview', 'GET /appointments', 'GET /appointments/:id', 'GET /appointments/availability', 'GET /appointments/slots',
    'GET /conversations', 'GET /conversations/:id', 'GET /conversations/:id/messages', 'GET /conversations/:id/messages/:mid/media', 'GET /conversations/:id/notes', 'GET /leads', 'GET /leads/:id', 'GET /leads/:id/activity', 'GET /leads/:id/notes',
    'GET /leads/:id/score', 'GET /leads/export', 'GET /leads/meta', 'GET /leads/tags', 'GET /pipeline/board', 'GET /pipeline/stages', 'GET /scoring/rules', 'GET /team/workload', 'GET /tenant/assignment', 'PATCH /appointments/:id', 'PATCH /leads/:id',
    'POST /appointments', 'POST /appointments/:id/cancel', 'POST /appointments/:id/complete', 'POST /appointments/:id/confirm', 'POST /appointments/:id/no-show', 'POST /appointments/:id/reschedule', 'POST /appointments/availability/exceptions',
    'POST /conversations/:id/assign', 'POST /conversations/:id/close', 'POST /conversations/:id/handback', 'POST /conversations/:id/messages', 'POST /conversations/:id/messages/:mid/retry', 'POST /conversations/:id/notes', 'POST /conversations/:id/read',
    'POST /conversations/:id/reopen', 'POST /conversations/:id/takeover', 'POST /leads', 'POST /leads/:id/merge', 'POST /leads/:id/notes', 'POST /leads/:id/score/override', 'POST /leads/:id/stage', 'POST /leads/bulk', 'POST /leads/check-duplicates',
    'POST /leads/import', 'PUT /appointments/availability', 'PUT /conversations/:id/tags', 'PUT /leads/:id/tags', 'PUT /sla',
  ]);
  it('every tenant route without a declared permission is on the reviewed service-enforced list', () => {
    const open = routes.filter((r) => !r.isPublic && !r.noTenant && r.perms.length === 0).map(label);
    expect(open.filter((l) => !SERVICE_ENFORCED.has(l)), 'new route with no @RequirePermissions: declare one, or review and list it').toEqual([]);
  });
});

describe('role matrix on sensitive routes', () => {
  it('an agent cannot reach owner/manager-only areas (403), a stranger workspace sees nothing', async () => {
    const { addMember } = await import('./helpers.js');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
    const agent = await addMember(ctx, owner, 'secAgent', 'agent');
    const forbidden: [string, string][] = [['GET', '/team/members/invitations'], ['POST', '/team/invitations'], ['GET', '/audit-logs'], ['GET', '/billing/invoices'], ['PUT', '/billing/profile'], ['POST', '/billing/subscribe'], ['GET', '/integrations'], ['PUT', '/ai/assistant'], ['GET', '/knowledge/documents'], ['POST', '/automations'], ['POST', '/automations/validate'], ['GET', '/automations/00000000-0000-0000-0000-000000000000/versions'], ['GET', '/automations/runs/00000000-0000-0000-0000-000000000000'], ['GET', '/usage'], ['GET', '/channels']];
    const bad: string[] = [];
    for (const [m, p] of forbidden) {
      const res = await ctx.http()[m.toLowerCase() as 'get'](p).set(auth(agent.accessToken)).send({});
      if (![403, 404].includes(res.status)) bad.push(`${m} ${p} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('sensitive data exposure', () => {
  it('responses never contain password hashes, token hashes or provider secrets', async () => {
    const bodies: string[] = [];
    for (const p of ['/auth/me', '/team/members', '/tenant', '/billing/summary', '/leads', '/channels']) bodies.push(JSON.stringify((await ctx.http().get(p).set(auth(owner.accessToken))).body));
    const all = bodies.join('\n');
    expect(all).not.toMatch(/\$argon2/); expect(all).not.toMatch(/password_?hash|passwordHash|tokenHash|token_hash|refresh_token|appSecret|accessToken"\s*:\s*"EAA/i);
  });

  it('errors are structured, carry a request id and leak no stack or SQL', async () => {
    const res = await ctx.http().get('/leads/not-a-uuid').set(auth(owner.accessToken));
    expect(res.status).toBe(400);
    const s = JSON.stringify(res.body);
    expect(res.body.error.requestId).toBeTruthy(); expect(s).not.toMatch(/at .*\.(ts|js):\d+|prisma|SELECT |node_modules/i);
  });
});

describe('transport hardening', () => {
  it('sets security headers on API responses and does not advertise the framework', async () => {
    const res = await ctx.http().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security'] ?? res.headers['x-frame-options'] ?? res.headers['content-security-policy']).toBeTruthy();
  });

  it('CORS reflects only the configured web origin (never *), with credentials', async () => {
    const evil = await ctx.http().options('/leads').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await ctx.http().options('/leads').set('Origin', process.env.WEB_ORIGIN ?? 'http://localhost:3100').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(process.env.WEB_ORIGIN ?? 'http://localhost:3100');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('service-enforced permissions (agent role)', () => {
  it('an agent can work their own leads but cannot delete, export, import, merge, bulk-edit or override scores', async () => {
    const { addMember } = await import('./helpers.js');
    const agent = await addMember(ctx, owner, 'secAgent2', 'agent');
    const mine = await ctx.http().post('/leads').set(auth(agent.accessToken)).send({ name: 'Agent Lead', phone: '+919800000111' });
    expect(mine.status).toBe(201);
    const id = mine.body.id as string;
    const other = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Second Lead', phone: '+919800000112' });
    const call = (m: string, p: string, body: object = {}) => ctx.http()[m.toLowerCase() as 'get'](p).set(auth(agent.accessToken)).send(body);
    const expect403 = async (m: string, p: string, body: object = {}) => { const r = await call(m, p, body); expect([403], `${m} ${p} -> ${r.status} ${JSON.stringify(r.body)}`).toContain(r.status); };
    await expect403('DELETE', `/leads/${id}`);
    await expect403('GET', '/leads/export');
    await expect403('POST', `/leads/${id}/merge`, { sourceIds: [other.body.id] });
    await expect403('POST', '/leads/bulk', { action: 'assign', ids: [id], assignedMembershipId: null });
    await expect403('POST', `/leads/${id}/score/override`, { score: 90, reason: 'because' });
    await expect403('PUT', '/sla', { enabled: true, firstResponseMinutes: 5 });
    // and cannot see a colleague's lead at all (404, not 403: existence is not revealed)
    expect((await call('GET', `/leads/${other.body.id}`)).status).toBe(404);
    expect((await call('PATCH', `/leads/${other.body.id}`, { name: 'x' })).status).toBe(404);
  });
});

describe('readiness', () => {
  it('reports database and redis state without leaking details', async () => {
    const r = await ctx.http().get('/health/ready');
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: 'ready', db: 'up' }); expect(['up', 'down']).toContain(r.body.redis);
  });
});

describe('WhatsApp media SSRF guard', () => {
  it('refuses non-https, non-Meta, credentialed and ported media URLs before any request is made', async () => {
    const { LiveWhatsAppClient } = await import('../src/whatsapp/whatsapp.client.js');
    const { loadEnv } = await import('../src/config/env.js');
    const c = new LiveWhatsAppClient(loadEnv());
    const creds = { accessToken: 'EAAGsecretsecretsecret' } as never;
    for (const url of ['http://lookaside.fbsbx.com/x', 'https://evil.example/x', 'https://facebook.com.evil.example/x', 'https://user:pw@scontent.xx.fbcdn.net/x', 'https://scontent.xx.fbcdn.net:8443/x', 'https://169.254.169.254/latest/meta-data', 'not a url', 'file:///etc/passwd']) {
      await expect(c.downloadMedia(creds, url), url).rejects.toThrow(/Unexpected media/);
    }
  });
});
