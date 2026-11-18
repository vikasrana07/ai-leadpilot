import { createHash, createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSignedRequest } from '../src/channels/meta-callbacks.js';
import { ENV } from '../src/common/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { cleanup, createTestApp, type TestCtx } from './helpers.js';

const SECRET = 'platform-app-secret-for-callback-tests-0123456789';
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
/** Builds a signed_request the way Facebook does: base64url(HMAC-SHA256(payload)) + "." + base64url(payload). */
const signed = (payload: Record<string, unknown>, secret = SECRET) => { const p = b64(JSON.stringify(payload)); return `${b64(createHmac('sha256', secret).update(p).digest())}.${p}`; };
const good = (userId = '1234567890123') => signed({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: 1_700_000_000 });

describe('parseSignedRequest', () => {
  it('reads a correctly signed request', () => { expect(parseSignedRequest(good(), SECRET)).toEqual({ userId: '1234567890123', issuedAt: 1_700_000_000 }); });
  it('rejects a wrong secret, a tampered payload, a missing or malformed value, the wrong algorithm and a non-numeric user', () => {
    expect(parseSignedRequest(good(), 'another-secret')).toBeNull();
    const [sig, payload] = good().split('.') as [string, string];
    expect(parseSignedRequest(`${sig}.${b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '999999' }))}`, SECRET)).toBeNull(); // payload changed, signature kept
    expect(parseSignedRequest(`${sig}.${payload}.extra`, SECRET)).toBeNull();
    for (const v of [undefined, null, 42, '', 'nodot', '.', 'a.b', { x: 1 }, 'x'.repeat(5000)]) expect(parseSignedRequest(v, SECRET), String(v)).toBeNull();
    expect(parseSignedRequest(signed({ algorithm: 'HMAC-SHA1', user_id: '123456' }), SECRET)).toBeNull();
    expect(parseSignedRequest(signed({ algorithm: 'HMAC-SHA256', user_id: 'abc; DROP' }), SECRET)).toBeNull();
    expect(parseSignedRequest(signed({ algorithm: 'HMAC-SHA256' }), SECRET)).toBeNull();
    expect(parseSignedRequest(good(), undefined)).toBeNull(); // no secret configured: nothing can be verified
    expect(parseSignedRequest('!!!.@@@', SECRET)).toBeNull();
  });
});

describe('Meta deauthorize and data-deletion callbacks', () => {
  let ctx: TestCtx; let off: TestCtx; let owner$: pg.Pool;
  beforeAll(async () => {
    ctx = await createTestApp([{ provide: ENV, useValue: { ...loadEnv(), EMBEDDED_SIGNUP_MODE: 'mock' as const, META_APP_SECRET: SECRET, WEB_ORIGIN: 'http://localhost:3100' } }]);
    off = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  });
  afterAll(async () => { await owner$.query("DELETE FROM meta_data_requests WHERE fb_user_hash = ANY($1)", [[hash('5550001'), hash('5550002'), hash('5550003')]]); await owner$.end(); await off.close(); await ctx.close(); await cleanup(); });
  const hash = (u: string) => createHash('sha256').update(u).digest('hex');
  const form = (c: TestCtx, path: string, sr: string) => c.http().post(path).type('form').send({ signed_request: sr });

  it('are invisible while Embedded Signup is off', async () => {
    expect((await form(off, '/webhooks/meta/deauthorize', good())).status).toBe(404);
    expect((await form(off, '/webhooks/meta/data-deletion', good())).status).toBe(404);
    expect((await off.http().get('/webhooks/meta/data-deletion/' + 'a'.repeat(24))).status).toBe(404);
  });

  it('refuse anything that is not signed by Meta, storing nothing', async () => {
    const before = (await owner$.query('SELECT count(*)::int n FROM meta_data_requests')).rows[0].n;
    for (const path of ['/webhooks/meta/deauthorize', '/webhooks/meta/data-deletion']) {
      expect((await form(ctx, path, signed({ algorithm: 'HMAC-SHA256', user_id: '5550001' }, 'not-the-platform-secret'))).status, path).toBe(400);
      expect((await ctx.http().post(path).type('form').send({})).status, path).toBe(400);
      expect((await ctx.http().post(path).send({ signed_request: 'garbage' })).status, path).toBe(400);
    }
    expect((await owner$.query('SELECT count(*)::int n FROM meta_data_requests')).rows[0].n).toBe(before);
  });

  it('deletion: answers with a confirmation code and a status URL, stores only a hash of the user id, and reuses the code for a retry', async () => {
    const sr = signed({ algorithm: 'HMAC-SHA256', user_id: '5550001' });
    const r = await form(ctx, '/webhooks/meta/data-deletion', sr);
    expect(r.status).toBe(200); expect(r.body.confirmation_code).toMatch(/^[A-Za-z0-9_-]{16,64}$/); expect(r.body.url).toBe(`http://localhost:3100/data-deletion?code=${r.body.confirmation_code}`);
    const row = (await owner$.query('SELECT * FROM meta_data_requests WHERE confirmation_code = $1', [r.body.confirmation_code])).rows[0];
    expect(row).toMatchObject({ kind: 'data_deletion', status: 'received', fb_user_hash: hash('5550001') }); expect(JSON.stringify(row)).not.toContain('5550001');
    expect((await form(ctx, '/webhooks/meta/data-deletion', sr)).body.confirmation_code).toBe(r.body.confirmation_code); // Meta retries: same code
    const other = await form(ctx, '/webhooks/meta/data-deletion', signed({ algorithm: 'HMAC-SHA256', user_id: '5550002' }));
    expect(other.body.confirmation_code).not.toBe(r.body.confirmation_code);
  });

  it('the status page data shows the status in plain words, and nothing for an unknown or malformed code', async () => {
    const code = (await form(ctx, '/webhooks/meta/data-deletion', signed({ algorithm: 'HMAC-SHA256', user_id: '5550003' }))).body.confirmation_code as string;
    const s = await ctx.http().get(`/webhooks/meta/data-deletion/${code}`);
    expect(s.status).toBe(200); expect(s.body.status).toBe('received'); expect(s.body.message).toContain('does not store your Facebook profile'); expect(Object.keys(s.body).sort()).toEqual(['message', 'receivedAt', 'status']);
    await owner$.query("UPDATE meta_data_requests SET status = 'completed', completed_at = now() WHERE confirmation_code = $1", [code]);
    expect((await ctx.http().get(`/webhooks/meta/data-deletion/${code}`)).body.status).toBe('completed');
    expect((await ctx.http().get('/webhooks/meta/data-deletion/' + 'z'.repeat(24))).status).toBe(404);
    expect((await ctx.http().get('/webhooks/meta/data-deletion/short')).status).toBe(404);
  });

  it('deauthorize: acknowledges a signed request and records it as its own kind; the table is invisible to workspaces', async () => {
    const r = await form(ctx, '/webhooks/meta/deauthorize', signed({ algorithm: 'HMAC-SHA256', user_id: '5550002' })); expect(r.status).toBe(200); expect(r.body).toEqual({ status: 'ok' });
    expect((await owner$.query("SELECT 1 FROM meta_data_requests WHERE kind = 'deauthorize' AND fb_user_hash = $1", [hash('5550002')])).rows).toHaveLength(1);
    // row-level security: with a workspace in scope the app role sees none of it
    const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const c = await app.connect();
      try { await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', gen_random_uuid()::text, true)"); expect((await c.query('SELECT count(*)::int n FROM meta_data_requests')).rows[0].n).toBe(0); await c.query('ROLLBACK'); } finally { c.release(); }
    } finally { await app.end(); }
  });
});
