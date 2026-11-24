import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { SecretBox } from '../src/crypto/secret-box.js';
import { DbService } from '../src/db/db.module.js';
import { GoogleCalendarService } from '../src/integrations/google-calendar/google-calendar.service.js';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-19: in live mode the Google Calendar service never refreshed access tokens (they last about an hour) and read the
 * RLS-protected `integration_credentials` table through the bare Prisma client with no tenant context, so every live push failed and the
 * errors were swallowed. Here the service runs in LIVE mode against the real database as the app role, with Google's HTTP API replaced by a stub.
 */
let ctx: TestCtx; let db: pg.Pool; let owner: Account; let svc: GoogleCalendarService; let membershipId: string;
const env = { ...loadEnv(), GOOGLE_CALENDAR_MODE: 'live' as const, GOOGLE_CALENDAR_CLIENT_ID: 'client-id', GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret' };

interface Call { url: string; method: string; bearer?: string; grant?: string }
let calls: Call[] = [];
/** Per-test behaviour of the fake Google. */
let google: { accessTokens: string[]; expiresIn: number; refreshError?: { status: number; error: string }; rejectBearer?: Set<string> };

function fakeFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const bearer = (init?.headers as Record<string, string> | undefined)?.authorization?.replace('Bearer ', '');
    const body = typeof init?.body === 'string' ? init.body : '';
    const grant = url.includes('/token') ? new URLSearchParams(body).get('grant_type') ?? undefined : undefined;
    calls.push({ url, method, ...(bearer ? { bearer } : {}), ...(grant ? { grant } : {}) });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/token')) {
      if (grant === 'authorization_code') return json(200, { access_token: 'A-initial', refresh_token: 'R-1', expires_in: 1 }); // expires immediately
      if (google.refreshError) return json(google.refreshError.status, { error: google.refreshError.error });
      return json(200, { access_token: google.accessTokens.shift() ?? 'A-next', expires_in: google.expiresIn });
    }
    if (url.includes('userinfo')) return json(200, { email: 'agent@example.test' });
    if (bearer && google.rejectBearer?.has(bearer)) return json(401, { error: { code: 401 } });
    if (url.includes('/freeBusy')) return json(200, { calendars: { primary: { busy: [{ start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z' }] } } });
    if (url.includes('/events') && method === 'POST') return json(200, { id: 'google-event-1' });
    return json(200, {});
  });
}

const connect = async () => {
  const state = new URL(svc.getAuthUrl(owner.tenantId, membershipId)).searchParams.get('state') as string;
  await svc.connect(owner.tenantId, membershipId, 'auth-code', state);
};
const syncRow = async () => (await db.query('SELECT status, credential_id FROM google_calendar_syncs WHERE membership_id = $1', [membershipId])).rows[0] as { status: string; credential_id: string } | undefined;
const busy = () => svc.getFreeBusy(owner.tenantId, [membershipId], new Date('2026-12-01T00:00:00Z'), new Date('2026-12-02T00:00:00Z'));
const refreshes = () => calls.filter((c) => c.grant === 'refresh_token').length;

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'gcalRefresh');
  membershipId = (await db.query('SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [owner.tenantId, owner.userId])).rows[0].id;
  svc = new GoogleCalendarService(ctx.app.get(DbService), ctx.app.get(SecretBox), env);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const s = await syncRow();
  await db.query('DELETE FROM google_calendar_syncs WHERE membership_id = $1', [membershipId]);
  if (s) await db.query('DELETE FROM integration_credentials WHERE id = $1', [s.credential_id]);
  calls = [];
});

afterAll(async () => {
  await db.query('DELETE FROM appointments WHERE tenant_id = $1', [owner.tenantId]);
  await db.end();
  await ctx.close();
  await cleanup();
});

const useGoogle = (g: Partial<typeof google> = {}) => {
  google = { accessTokens: [], expiresIn: 3600, ...g };
  vi.stubGlobal('fetch', fakeFetch());
};

describe('Google Calendar live mode under RLS', () => {
  it('refreshes an expired access token before calling Google, and stores the new one', async () => {
    useGoogle({ accessTokens: ['A-refreshed'] });
    await connect(); // the initial token expires immediately
    const before = (await db.query('SELECT ciphertext FROM integration_credentials WHERE id = $1', [(await syncRow())!.credential_id])).rows[0].ciphertext;
    const out = await busy();
    expect(out).toHaveLength(1);
    expect(refreshes()).toBe(1);
    expect(calls.find((c) => c.url.includes('/freeBusy'))?.bearer).toBe('A-refreshed'); // never the stale token
    const after = (await db.query('SELECT ciphertext FROM integration_credentials WHERE id = $1', [(await syncRow())!.credential_id])).rows[0].ciphertext;
    expect(after).not.toBe(before);
    await busy(); // the refreshed token is valid for an hour: no second refresh
    expect(refreshes()).toBe(1);
  });

  it('retries once with a fresh token when Google rejects a token that was not yet due to expire', async () => {
    useGoogle({ accessTokens: ['A-1', 'A-2'], rejectBearer: new Set(['A-1']) });
    await connect();
    expect(await busy()).toHaveLength(1);
    expect(refreshes()).toBe(2); // proactive refresh (expired), then a forced one after the 401
    expect(calls.filter((c) => c.url.includes('/freeBusy')).map((c) => c.bearer)).toEqual(['A-1', 'A-2']);
  });

  it('marks the connection needs_reauth when Google says the grant was revoked, and stops calling Google', async () => {
    useGoogle({ refreshError: { status: 400, error: 'invalid_grant' } });
    await connect();
    expect(await busy()).toEqual([]); // degrades to "no busy time", does not throw
    expect((await syncRow())?.status).toBe('needs_reauth');
    const status = await svc.getStatus(owner.tenantId, membershipId);
    expect(status).toMatchObject({ connected: false, status: 'needs_reauth' });
    calls = [];
    await busy();
    expect(calls).toEqual([]); // not active any more: no further Google traffic
    // reconnecting restores it
    useGoogle({ accessTokens: ['A-after'] });
    await connect();
    expect((await syncRow())?.status).toBe('active');
  });

  it('a transient refresh failure does not disconnect the member', async () => {
    useGoogle({ refreshError: { status: 503, error: 'backend_error' } });
    await connect();
    expect(await busy()).toEqual([]);
    expect((await syncRow())?.status).toBe('active');
  });

  it('pushes an appointment to Google using the member credential (read under the tenant transaction)', async () => {
    useGoogle({ accessTokens: ['A-push'] });
    await connect();
    const lead = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Push Lead', phone: '+919800000601' });
    const appointmentId = randomUUID();
    await db.query(`INSERT INTO appointments (id, tenant_id, lead_id, membership_id, title, starts_at, ends_at, updated_at) VALUES ($1, $2, $3, $4, 'Site visit', '2026-12-05T10:00:00Z', '2026-12-05T11:00:00Z', now())`, [appointmentId, owner.tenantId, lead.body.id, membershipId]);
    await ctx.app.get(DbService).tenantTx({ tenantId: owner.tenantId }, (tx) => svc.syncAppointment(tx, owner.tenantId, appointmentId, 'created'));
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/events'));
    expect(post?.bearer).toBe('A-push');
    expect((await db.query('SELECT google_event_id FROM appointments WHERE id = $1', [appointmentId])).rows[0].google_event_id).toBe('google-event-1');
  });

  describe('strict mode (used by the outbox relay)', () => {
    const makeAppointment = async () => {
      const lead = await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Strict Lead', phone: `+9198000007${Math.floor(Math.random() * 90 + 10)}` });
      const id = randomUUID();
      await db.query(`INSERT INTO appointments (id, tenant_id, lead_id, membership_id, title, starts_at, ends_at, updated_at) VALUES ($1, $2, $3, $4, 'Visit', '2026-12-09T10:00:00Z', '2026-12-09T11:00:00Z', now())`, [id, owner.tenantId, lead.body.id, membershipId]);
      return id;
    };
    const sync = async (id: string) => ctx.app.get(DbService).tenantTx({ tenantId: owner.tenantId }, (tx) => svc.syncAppointment(tx, owner.tenantId, id, 'created', { strict: true }));

    it('rethrows a transient Google failure so the relay retries it', async () => {
      useGoogle({ refreshError: { status: 503, error: 'backend_error' } });
      await connect();
      await expect(sync(await makeAppointment())).rejects.toThrow(/token refresh failed/);
      expect((await syncRow())?.status).toBe('active'); // still connected
    });

    it('does NOT throw for a revoked grant: retrying cannot help, the member must reconnect', async () => {
      useGoogle({ refreshError: { status: 400, error: 'invalid_grant' } });
      await connect();
      await expect(sync(await makeAppointment())).resolves.toBeUndefined();
      expect((await syncRow())?.status).toBe('needs_reauth');
    });
  });
});
