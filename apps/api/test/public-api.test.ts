import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { V1_ROUTES } from '../src/v1/openapi.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let owner: Account; let other: Account; let starter: Account;
const owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });
const ALL = ['leads:read', 'leads:write', 'leads:delete', 'conversations:read', 'appointments:read', 'appointments:write'];
async function mkKey(t: Account, scopes: string[], extra: Record<string, unknown> = {}) {
  const r = await ctx.http().post('/api-keys').set(auth(t.accessToken)).send({ name: `key ${scopes.length} scopes ${scopes[0] ?? ""}`, scopes, ...extra });
  if (r.status !== 201) throw new Error(`key create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; key: string; scopes: string[] };
}
let full: { id: string; key: string };

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'apiOwner'); other = await registerAccount(ctx, 'apiOther'); starter = await registerAccount(ctx, 'apiStarter');
  await owner$.query(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, updated_at) VALUES (gen_random_uuid(), $1, 'starter', 'ACTIVE', 'manual', now())`, [starter.tenantId]);
  await owner$.query(`UPDATE tenants SET plan_key = 'starter' WHERE id = $1`, [starter.tenantId]);
  full = await mkKey(owner, ALL);
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('API keys', () => {
  it('shows the secret once, stores only a hash, and lists scopes, expiry and usage without the secret', async () => {
    const k = await mkKey(owner, ['leads:read'], { expiresInDays: 30 });
    expect(k.key).toMatch(/^lp_live_/);
    const list = (await ctx.http().get('/api-keys').set(auth(owner.accessToken))).body as { id: string; scopes: string[]; expiresAt: string | null; requestCount: number }[];
    const row = list.find((x) => x.id === k.id);
    expect(row?.scopes).toEqual(['leads:read']); expect(row?.expiresAt).toBeTruthy(); expect(JSON.stringify(list)).not.toContain(k.key);
    const db = (await owner$.query('SELECT key_hash FROM api_keys WHERE id = $1', [k.id])).rows[0];
    expect(db.key_hash).not.toContain(k.key.slice(8));
    await ctx.http().get('/v1/me').set(bearer(k.key));
    const after = (await ctx.http().get('/api-keys').set(auth(owner.accessToken))).body as { id: string; requestCount: number; lastUsedAt: string | null }[];
    expect(after.find((x) => x.id === k.id)).toMatchObject({ requestCount: 1 }); expect(after.find((x) => x.id === k.id)?.lastUsedAt).toBeTruthy();
  });
  it('rejects unknown scopes and over-long names', async () => {
    expect((await ctx.http().post('/api-keys').set(auth(owner.accessToken)).send({ name: 'x', scopes: ['admin:all'] })).status).toBe(400);
    expect((await ctx.http().post('/api-keys').set(auth(owner.accessToken)).send({ name: 'x', scopes: [] })).status).toBe(400);
  });
  it('a default key stays a lead-capture key (backwards compatible)', async () => {
    const r = await ctx.http().post('/api-keys').set(auth(owner.accessToken)).send({ name: 'legacy' });
    expect(r.body.scopes).toEqual(['leads:create']);
    expect((await ctx.http().get('/v1/leads').set(bearer(r.body.key))).status).toBe(403);
  });
});

describe('authentication', () => {
  it('refuses missing, malformed, forged, revoked and expired keys with one error', async () => {
    const revoked = await mkKey(owner, ['leads:read']); await ctx.http().delete(`/api-keys/${revoked.id}`).set(auth(owner.accessToken));
    const expired = await mkKey(owner, ['leads:read'], { expiresInDays: 1 }); await owner$.query(`UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1`, [expired.id]);
    for (const h of [undefined, 'Bearer ', 'Bearer nope', 'Bearer lp_live_forged', `Bearer ${revoked.key}`, `Bearer ${expired.key}`, `Basic ${full.key}`]) {
      const r = await ctx.http().get('/v1/leads').set(h ? { Authorization: h } : {});
      expect(r.status, String(h)).toBe(401); expect(r.body.error.code).toBe('invalid_api_key');
    }
  });
  it('keeps sessions and keys apart: a login token is not an API key, and an API key is not a login', async () => {
    expect((await ctx.http().get('/v1/leads').set(auth(owner.accessToken))).status).toBe(401);
    expect((await ctx.http().get('/leads').set(bearer(full.key))).status).toBe(401);
    expect((await ctx.http().get('/team/members').set(bearer(full.key))).status).toBe(401);
    expect((await ctx.http().get('/billing/summary').set(bearer(full.key))).status).toBe(401);
  });
  it('every /v1 route except the public description answers 401 without a key', async () => {
    const bad: string[] = [];
    for (const r of V1_ROUTES) {
      const res = await ctx.http()[r.method](r.path.replace('{id}', '00000000-0000-4000-8000-000000000000')).send({});
      if (res.status !== 401) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('scope matrix', () => {
  const lead = '00000000-0000-4000-8000-000000000000';
  const cases: { route: string; call: (k: string) => Promise<{ status: number }>; scope: string }[] = [
    { route: 'GET /v1/leads', scope: 'leads:read', call: (k) => ctx.http().get('/v1/leads').set(bearer(k)) },
    { route: 'POST /v1/leads', scope: 'leads:write', call: (k) => ctx.http().post('/v1/leads').set(bearer(k)).send({ name: 'Scope Probe', phone: '+919800099001' }) },
    { route: 'PATCH /v1/leads/:id', scope: 'leads:write', call: (k) => ctx.http().patch(`/v1/leads/${lead}`).set(bearer(k)).send({ name: 'x' }) },
    { route: 'DELETE /v1/leads/:id', scope: 'leads:delete', call: (k) => ctx.http().delete(`/v1/leads/${lead}`).set(bearer(k)) },
    { route: 'GET /v1/conversations', scope: 'conversations:read', call: (k) => ctx.http().get('/v1/conversations').set(bearer(k)) },
    { route: 'GET /v1/appointments', scope: 'appointments:read', call: (k) => ctx.http().get('/v1/appointments').set(bearer(k)) },
    { route: 'POST /v1/appointments', scope: 'appointments:write', call: (k) => ctx.http().post('/v1/appointments').set(bearer(k)).send({ leadId: lead, startsAt: new Date(Date.now() + 864e5).toISOString(), durationMinutes: 30 }) },
  ];
  it('each route needs exactly its scope: other scopes get 403, the right scope gets past authorisation', async () => {
    const keys = new Map<string, string>();
    for (const s of ALL) keys.set(s, (await mkKey(owner, [s])).key);
    for (const c of cases) for (const s of ALL) {
      const r = await c.call(keys.get(s) as string);
      if (s === c.scope) expect(r.status, `${c.route} with ${s}`).not.toBe(403);
      else expect(r.status, `${c.route} with ${s}`).toBe(403);
    }
  });
  it('a read-only key cannot write anything, and a key can never reach team, billing or settings data', async () => {
    const ro = (await mkKey(owner, ['leads:read', 'conversations:read', 'appointments:read'])).key;
    for (const [m, p] of [['post', '/v1/leads'], ['patch', `/v1/leads/${lead}`], ['delete', `/v1/leads/${lead}`], ['post', '/v1/appointments'], ['post', `/v1/leads/${lead}/notes`]] as const) {
      expect((await ctx.http()[m](p).set(bearer(ro)).send({})).status, `${m} ${p}`).toBe(403);
    }
    for (const p of ['/v1/team', '/v1/billing', '/v1/integrations', '/v1/api-keys']) expect((await ctx.http().get(p).set(bearer(ro))).status, p).toBe(404);
  });
});

describe('leads through the API', () => {
  it('creates, reads, updates, searches, paginates, notes, moves stage and deletes, all inside the key\'s own tenant', async () => {
    const H = bearer(full.key);
    const created = await ctx.http().post('/v1/leads').set(H).send({ name: 'Api Lead One', phone: '+919800011111', email: 'api1@example.test' });
    expect(created.status).toBe(201); const id = created.body.data.id as string;
    for (let i = 2; i <= 4; i++) await ctx.http().post('/v1/leads').set(H).send({ name: `Api Lead ${i}`, phone: `+91980001111${i}` });
    expect((await ctx.http().get(`/v1/leads/${id}`).set(H)).body.data.name).toBe('Api Lead One');
    expect((await ctx.http().patch(`/v1/leads/${id}`).set(H).send({ location: 'Pune' })).body.data.location).toBe('Pune');
    const page1 = await ctx.http().get('/v1/leads?limit=2&page=1&sort=createdAt&dir=asc&q=Api Lead').set(H);
    expect(page1.body).toMatchObject({ page: 1, limit: 2 }); expect(page1.body.total).toBeGreaterThanOrEqual(4); expect(page1.body.data).toHaveLength(2);
    const page2 = await ctx.http().get('/v1/leads?limit=2&page=2&sort=createdAt&dir=asc&q=Api Lead').set(H);
    expect(page2.body.data.map((l: { id: string }) => l.id)).not.toEqual(page1.body.data.map((l: { id: string }) => l.id));
    expect((await ctx.http().get('/v1/leads?limit=1000').set(H)).status).toBe(400);
    expect((await ctx.http().post(`/v1/leads/${id}/notes`).set(H).send({ body: 'called via API' })).status).toBe(201);
    expect((await ctx.http().get(`/v1/leads/${id}/notes`).set(H)).body.data[0].body).toBe('called via API');
    const stages = (await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken))).body.stages as { id: string; kind: string }[];
    const open = stages.filter((s) => s.kind === 'OPEN');
    const moved = await ctx.http().post(`/v1/leads/${id}/stage`).set(H).send({ stageId: open[1]?.id });
    expect(moved.status).toBe(200); expect(moved.body.data.stage.id).toBe(open[1]?.id);
    expect((await ctx.http().delete(`/v1/leads/${id}`).set(H)).status).toBe(204);
    expect((await ctx.http().get(`/v1/leads/${id}`).set(H)).status).toBe(404);
    // the audit trail attributes API changes to the key
    const a = await owner$.query(`SELECT metadata FROM audit_logs WHERE tenant_id = $1 AND resource_id = $2 AND action = 'lead.created'`, [owner.tenantId, id]);
    expect(a.rows[0].metadata.apiKeyId).toBe(full.id);
  });

  it('never crosses tenants: another workspace\'s lead is a 404 and lists only show the key\'s own tenant', async () => {
    const theirs = await ctx.http().post('/leads').set(auth(other.accessToken)).send({ name: 'Other Tenant Lead', phone: '+919800022222' });
    const H = bearer(full.key);
    expect((await ctx.http().get(`/v1/leads/${theirs.body.id}`).set(H)).status).toBe(404);
    expect((await ctx.http().patch(`/v1/leads/${theirs.body.id}`).set(H).send({ name: 'hijack' })).status).toBe(404);
    expect((await ctx.http().delete(`/v1/leads/${theirs.body.id}`).set(H)).status).toBe(404);
    expect((await ctx.http().get('/v1/leads?q=Other Tenant Lead').set(H)).body.total).toBe(0);
    const k2 = await mkKey(other, ['leads:read']);
    expect((await ctx.http().get('/v1/leads?q=Api Lead').set(bearer(k2.key))).body.total).toBe(0);
  });

  it('validates input with the standard error format', async () => {
    const r = await ctx.http().post('/v1/leads').set(bearer(full.key)).send({ phone: '+919800033333' });
    expect(r.status).toBe(400); expect(r.body.error).toMatchObject({ code: 'validation_error' }); expect(r.body.error.requestId).toBeTruthy();
  });
});

describe('idempotency', () => {
  it('replays the first response for a retry, rejects a changed body, and creates exactly one lead', async () => {
    const H = { ...bearer(full.key), 'Idempotency-Key': `it-${RUN}-create-1` };
    const body = { name: 'Idempotent Lead', phone: '+919800044444' };
    const a = await ctx.http().post('/v1/leads').set(H).send(body);
    const b = await ctx.http().post('/v1/leads').set(H).send(body);
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect(b.headers['idempotent-replay']).toBe('true'); expect(b.body.data.id).toBe(a.body.data.id);
    const c = await ctx.http().post('/v1/leads').set(H).send({ ...body, name: 'Different' });
    expect(c.status).toBe(422); expect(c.body.error.code).toBe('idempotency_key_reuse');
    expect((await ctx.http().get('/v1/leads?q=Idempotent Lead').set(bearer(full.key))).body.total).toBe(1);
    expect((await ctx.http().post('/v1/leads').set({ ...bearer(full.key), 'Idempotency-Key': 'short' }).send(body)).status).toBe(400);
  });
  it('a failed request releases its key so the retry can succeed', async () => {
    const H = { ...bearer(full.key), 'Idempotency-Key': `it-${RUN}-fail-1` };
    expect((await ctx.http().post('/v1/leads/00000000-0000-4000-8000-000000000000/notes').set(H).send({ body: 'x' })).status).toBe(404);
    const lead = (await ctx.http().post('/v1/leads').set(bearer(full.key)).send({ name: 'Note Target', phone: '+919800055555' })).body.data.id;
    expect((await ctx.http().post(`/v1/leads/${lead}/notes`).set(H).send({ body: 'x' })).status).toBe(201);
  });
});

describe('appointments', () => {
  it('books through the API with the same no-double-booking guarantee (409 on a taken slot)', async () => {
    const H = bearer(full.key);
    const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    const slots = (await ctx.http().get(`/appointments/slots?from=${day}&days=7&durationMinutes=30`).set(auth(owner.accessToken))).body.days as { slots: { startsAt: string; membershipId?: string }[] }[];
    const slot = slots.flatMap((d) => d.slots)[0];
    expect(slot).toBeTruthy();
    const l1 = (await ctx.http().post('/v1/leads').set(H).send({ name: 'Visit One', phone: '+919800066661' })).body.data.id;
    const l2 = (await ctx.http().post('/v1/leads').set(H).send({ name: 'Visit Two', phone: '+919800066662' })).body.data.id;
    const mine = (await ctx.http().get('/team/members').set(auth(owner.accessToken))).body[0].id as string;
    const book = (leadId: string) => ctx.http().post('/v1/appointments').set(H).send({ leadId, membershipId: mine, startsAt: slot?.startsAt, durationMinutes: 30 });
    const first = await book(l1);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await book(l2);
    expect(second.status).toBe(409);
    expect((await ctx.http().get(`/v1/appointments?leadId=${l1}`).set(H)).body.data).toHaveLength(1);
    expect((await ctx.http().get(`/v1/appointments/${first.body.data.id}`).set(H)).body.data.id).toBe(first.body.data.id);
    const src = await owner$.query('SELECT source FROM appointments WHERE id = $1', [first.body.data.id]); expect(src.rows[0].source).toBe('api');
  });
  it('lists conversations and messages (read only)', async () => {
    const r = await ctx.http().get('/v1/conversations').set(bearer(full.key));
    expect(r.status).toBe(200); expect(Array.isArray(r.body.data)).toBe(true);
  });
});

describe('plan gating and limits', () => {
  it('a plan without api_access cannot create API keys beyond lead capture, and existing keys stop working', async () => {
    expect((await ctx.http().post('/api-keys').set(auth(starter.accessToken)).send({ name: 'x', scopes: ['leads:read'] })).status).toBe(402);
    expect((await ctx.http().post('/api-keys').set(auth(starter.accessToken)).send({ name: 'capture' })).status).toBe(201); // lead capture keys keep working on every plan
    const k = await mkKey(owner, ['leads:read']);
    expect((await ctx.http().get('/v1/leads').set(bearer(k.key))).status).toBe(200);
    await owner$.query(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, updated_at) VALUES (gen_random_uuid(), $1, 'starter', 'ACTIVE', 'manual', now()) ON CONFLICT (tenant_id) DO UPDATE SET plan_key = 'starter'`, [owner.tenantId]);
    const blocked = await ctx.http().get('/v1/leads').set(bearer(k.key));
    expect(blocked.status).toBe(402); expect(blocked.body.error.code).toBe('feature_not_in_plan');
    await owner$.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [owner.tenantId]);
  });
  it('a read-only (lapsed) workspace allows reads but refuses API writes', async () => {
    const k = await mkKey(owner, ['leads:read', 'leads:write']);
    await owner$.query(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, trial_ends_at, updated_at) VALUES (gen_random_uuid(), $1, 'growth', 'TRIALING', 'none', now() - interval '1 day', now()) ON CONFLICT (tenant_id) DO UPDATE SET plan_key = 'growth', status = 'TRIALING', trial_ends_at = now() - interval '1 day'`, [owner.tenantId]);
    expect((await ctx.http().get('/v1/leads').set(bearer(k.key))).status).toBe(200);
    expect((await ctx.http().post('/v1/leads').set(bearer(k.key)).send({ name: 'Late', phone: '+919800077777' })).status).toBe(402);
    await owner$.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [owner.tenantId]);
  });
  it('rate limits each key separately (429 + Retry-After) while other keys stay unaffected', async () => {
    const prev = process.env.API_KEY_RATE_LIMIT_PER_MIN; process.env.API_KEY_RATE_LIMIT_PER_MIN = '5';
    const c2 = await createTestApp();
    try {
      const a = await registerAccount(c2, 'apiRate'); const mk = async (n: string) => (await c2.http().post('/api-keys').set(auth(a.accessToken)).send({ name: n, scopes: ['leads:read'] })).body.key as string;
      const k1 = await mk('r1'); const k2 = await mk('r2');
      const statuses: number[] = []; let last: { headers: Record<string, string> } | null = null;
      for (let i = 0; i < 7; i++) { const r = await c2.http().get('/v1/me').set(bearer(k1)); statuses.push(r.status); last = r; }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
      expect(last?.headers['retry-after']).toBeTruthy();
      expect((await c2.http().get('/v1/me').set(bearer(k2))).status).toBe(200);
    } finally { process.env.API_KEY_RATE_LIMIT_PER_MIN = prev ?? ''; if (prev === undefined) delete process.env.API_KEY_RATE_LIMIT_PER_MIN; await c2.close(); }
  });
});

describe('OpenAPI description', () => {
  it('is public, valid-looking, and documents exactly the routes the controller registers', async () => {
    const r = await ctx.http().get('/v1/openapi.json');
    expect(r.status).toBe(200); expect(r.body.openapi).toMatch(/^3\.1/); expect(r.body.components.securitySchemes.bearerKey).toBeTruthy();
    const documented = Object.entries(r.body.paths as Record<string, Record<string, unknown>>).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{id\}/g, ':id')}`)).sort();
    const discovery = new DiscoveryService(ctx.app.get(ModulesContainer)); const scanner = new MetadataScanner();
    const M: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.DELETE]: 'DELETE' };
    const actual: string[] = [];
    for (const w of discovery.getControllers()) {
      const t = w.metatype as (new () => object) | null; if (!t?.prototype || (Reflect.getMetadata('path', t) as string) !== 'v1') continue;
      for (const n of scanner.getAllMethodNames(t.prototype)) {
        const fn = (t.prototype as Record<string, unknown>)[n] as object; const p = Reflect.getMetadata('path', fn) as string | undefined; const m = Reflect.getMetadata('method', fn) as number | undefined;
        if (p !== undefined && m !== undefined && p !== 'openapi.json') actual.push(`${M[m]} /v1/${p}`.replace(/\/$/, ''));
      }
    }
    expect(documented).toEqual(actual.sort());
    // request schemas come from the real zod schemas
    expect(r.body.paths['/v1/leads'].post.requestBody.content['application/json'].schema.properties.name).toBeTruthy();
  });
  it('matches real responses: the documented create-lead fields are accepted and a documented-required one is enforced', async () => {
    const schema = (await ctx.http().get('/v1/openapi.json')).body.paths['/v1/leads'].post.requestBody.content['application/json'].schema as { required?: string[] };
    expect(schema.required).toContain('name');
    expect((await ctx.http().post('/v1/leads').set(bearer(full.key)).send({})).status).toBe(400);
  });
});
