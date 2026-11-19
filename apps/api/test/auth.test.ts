import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, WEB_ORIGIN, type TestCtx } from './helpers.js';

import pg from 'pg';
let ctx: TestCtx;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await pool.end(); await ctx.close(); await cleanup(); });

describe('registration', () => {
  it('creates an isolated workspace with the owner role and all permissions', async () => {
    const a = await registerAccount(ctx, 'reg1');
    const me = await ctx.http().get('/auth/me').set(auth(a.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.workspaces).toHaveLength(1);
    expect(me.body.workspaces[0].roleKey).toBe('owner');
    expect(me.body.permissions).toContain('billing:manage');
    expect(me.body.user.emailVerified).toBe(false);
    expect(ctx.mail.last('verify', a.email)?.token).toBeTruthy();
  });

  it('does not reveal whether an email is already registered', async () => {
    const first = await registerAccount(ctx, 'dup');
    const res = await ctx.http().post('/auth/register').send({ name: 'Other', email: first.email, password: PASSWORD, businessName: 'Another Biz' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Check your email to continue.' });
    expect(ctx.mail.last('exists', first.email)).toBeTruthy();
  });

  it('rejects weak passwords and malformed input with field-level errors', async () => {
    const res = await ctx.http().post('/auth/register').send({ name: 'X', email: 'nope', password: 'short', businessName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.length).toBeGreaterThan(2);
  });

  it('verifies email with a single-use token', async () => {
    const a = await registerAccount(ctx, 'verify');
    const token = ctx.mail.last('verify', a.email)?.token as string;
    expect((await ctx.http().post('/auth/verify-email').send({ token })).status).toBe(204);
    expect((await ctx.http().post('/auth/verify-email').send({ token })).status).toBe(400);
    const me = await ctx.http().get('/auth/me').set(auth(a.accessToken));
    expect(me.body.user.emailVerified).toBe(true);
  });
});

describe('login & lockout', () => {
  it('logs in with correct credentials, and gives an identical error for unknown user and wrong password', async () => {
    const a = await registerAccount(ctx, 'login');
    const ok = await ctx.http().post('/auth/login').send({ email: a.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    const bad = await ctx.http().post('/auth/login').send({ email: a.email, password: 'WrongPassw0rd!' });
    const unknown = await ctx.http().post('/auth/login').send({ email: `nobody-${RUN}@example.test`, password: 'WrongPassw0rd!' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.code).toBe(unknown.body.error.code);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    const a = await registerAccount(ctx, 'lock');
    for (let i = 0; i < 5; i++) await ctx.http().post('/auth/login').send({ email: a.email, password: 'WrongPassw0rd!' });
    const res = await ctx.http().post('/auth/login').send({ email: a.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('sessions & refresh rotation', () => {
  it('rotates refresh tokens; a near-simultaneous reuse is a harmless race, a later reuse revokes the family', async () => {
    const a = await registerAccount(ctx, 'rot');
    const r1 = await ctx.http().post('/auth/refresh').set('x-token-delivery', 'body').send({ refreshToken: a.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(a.refreshToken);
    // another tab refreshing with the SAME cookie a moment later: rejected, but the family survives
    const race = await ctx.http().post('/auth/refresh').send({ refreshToken: a.refreshToken });
    expect(race.status).toBe(401); expect(race.body.error.code).toBe('refresh_race');
    const r2 = await ctx.http().post('/auth/refresh').set('x-token-delivery', 'body').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(200);
    // replaying the original token well after the grace window is a theft signal: the whole family dies
    await pool.query(`UPDATE sessions SET rotated_at = now() - interval '1 minute' WHERE refresh_token_hash = encode(sha256($1::bytea), 'hex')`, [a.refreshToken]);
    const replay = await ctx.http().post('/auth/refresh').send({ refreshToken: a.refreshToken });
    expect(replay.status).toBe(401); expect(replay.body.error.code).toBe('invalid_refresh');
    expect((await ctx.http().post('/auth/refresh').send({ refreshToken: r2.body.refreshToken })).status).toBe(401);
    expect((await ctx.http().get('/auth/me').set(auth(r2.body.accessToken))).status).toBe(401);
  });

  it('logout invalidates the access token immediately', async () => {
    const a = await registerAccount(ctx, 'logout');
    expect((await ctx.http().get('/auth/me').set(auth(a.accessToken))).status).toBe(200);
    expect((await ctx.http().post('/auth/logout').set(auth(a.accessToken))).status).toBe(204);
    expect((await ctx.http().get('/auth/me').set(auth(a.accessToken))).status).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const a = await registerAccount(ctx, 'sess');
    const second = await ctx.http().post('/auth/login').set('x-token-delivery', 'body').send({ email: a.email, password: PASSWORD });
    const list = await ctx.http().get('/auth/sessions').set(auth(a.accessToken));
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    expect((await ctx.http().delete(`/auth/sessions/${other.id}`).set(auth(a.accessToken))).status).toBe(204);
    expect((await ctx.http().get('/auth/me').set(auth(second.body.accessToken))).status).toBe(401);
  });

  it('rejects tampered, garbage and missing tokens', async () => {
    const a = await registerAccount(ctx, 'tamper');
    const tampered = a.accessToken.slice(0, -4) + 'AAAA';
    expect((await ctx.http().get('/auth/me').set(auth(tampered))).status).toBe(401);
    expect((await ctx.http().get('/auth/me').set(auth('not-a-jwt'))).status).toBe(401);
    expect((await ctx.http().get('/auth/me')).status).toBe(401);
    expect((await ctx.http().get('/tenant')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('responds identically for unknown emails, resets once, and kills existing sessions', async () => {
    const a = await registerAccount(ctx, 'reset');
    const unknown = await ctx.http().post('/auth/forgot-password').send({ email: `ghost-${RUN}@example.test` });
    const known = await ctx.http().post('/auth/forgot-password').send({ email: a.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(ctx.mail.last('reset', `ghost-${RUN}@example.test`)).toBeUndefined();
    const token = ctx.mail.last('reset', a.email)?.token as string;
    const newPw = 'Brand-New-Passw0rd';
    expect((await ctx.http().post('/auth/reset-password').send({ token, password: newPw })).status).toBe(204);
    expect((await ctx.http().post('/auth/reset-password').send({ token, password: newPw })).status).toBe(400);
    expect((await ctx.http().get('/auth/me').set(auth(a.accessToken))).status).toBe(401);
    expect((await pool.query("SELECT count(*)::int n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL", [a.userId])).rows[0].n).toBe(0);
    expect((await ctx.http().post('/auth/login').send({ email: a.email, password: PASSWORD })).status).toBe(401);
    expect((await ctx.http().post('/auth/login').send({ email: a.email, password: newPw })).status).toBe(200);
  });
});

describe('CSRF origin check for cookie auth', () => {
  it('blocks cookie-authenticated writes without a trusted Origin, allows with one', async () => {
    const a = await registerAccount(ctx, 'csrf');
    const cookie = `lp_at=${a.accessToken}`;
    const blocked = await ctx.http().patch('/tenant').set('Cookie', cookie).set('Origin', 'https://evil.example').send({ name: 'Hacked Name' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('csrf_blocked');
    const noOrigin = await ctx.http().patch('/tenant').set('Cookie', cookie).send({ name: 'Hacked Name' });
    expect(noOrigin.status).toBe(403);
    const allowed = await ctx.http().patch('/tenant').set('Cookie', cookie).set('Origin', WEB_ORIGIN).send({ name: 'Renamed Biz' });
    expect(allowed.status).toBe(200);
  });
});

describe('error hygiene', () => {
  it('returns a structured error with a request id and no stack traces', async () => {
    const res = await ctx.http().get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});
