import argon2 from 'argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, stepAt, verifyTotp } from '../src/mfa/totp.js';
import { addMember, auth, cleanup, createTestApp, PASSWORD, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

const codeAt = (secret: string, offsetSteps = 0) => hotp(base32Decode(secret), stepAt(Date.now()) + offsetSteps);

describe('TOTP primitives (RFC 6238)', () => {
  const ascii = Buffer.from('12345678901234567890');
  it('matches the RFC 6238 SHA-1 test vectors (last 6 digits of the 8-digit values)', () => {
    const vec: [number, string][] = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
    for (const [t, want] of vec) expect(hotp(ascii, Math.floor(t / 30)), `T=${t}`).toBe(want);
  });
  it('round-trips base32 and produces a standard otpauth URI', () => {
    expect(base32Encode(ascii)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(ascii)).toBe(true);
    const u = otpauthUri('LeadPilot', 'a@b.test', 'ABC'); expect(u).toMatch(/^otpauth:\/\/totp\/LeadPilot%3Aa%40b\.test\?secret=ABC&issuer=LeadPilot&algorithm=SHA1&digits=6&period=30$/);
  });
  it('accepts one step of clock skew either way, rejects two, and never accepts a step twice', () => {
    const secret = base32Encode(ascii); const now = 1_700_000_000_000; const step = stepAt(now);
    const at = (s: number) => hotp(ascii, s);
    expect(verifyTotp(secret, at(step), now, 0)).toBe(step);
    expect(verifyTotp(secret, at(step - 1), now, 0)).toBe(step - 1);
    expect(verifyTotp(secret, at(step + 1), now, 0)).toBe(step + 1);
    expect(verifyTotp(secret, at(step - 2), now, 0)).toBeNull();
    expect(verifyTotp(secret, at(step + 2), now, 0)).toBeNull();
    expect(verifyTotp(secret, at(step), now, step)).toBeNull(); // replay of the step already used
    expect(verifyTotp(secret, at(step - 1), now, step)).toBeNull(); // an older code inside the window cannot be used after a newer one
    expect(verifyTotp(secret, '12345', now, 0)).toBeNull(); expect(verifyTotp(secret, 'abcdef', now, 0)).toBeNull();
  });
});

let ctx: TestCtx; const owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

async function enrol(token: string, base = '/security/mfa', extra: Record<string, string> = {}) {
  const start = await ctx.http().post(`${base}/enroll`).set(auth(token)).set(extra).send({});
  expect(start.status).toBe(200);
  const secret = start.body.secret as string;
  const confirm = await ctx.http().post(`${base}/confirm`).set(auth(token)).set(extra).send({ code: codeAt(secret) });
  expect(confirm.status).toBe(200);
  return { secret, recoveryCodes: confirm.body.recoveryCodes as string[], start: start.body };
}
const login = (email: string) => ctx.http().post('/auth/login').set('x-token-delivery', 'body').send({ email, password: PASSWORD });

describe('tenant user MFA', () => {
  let u: Account; let secret = ''; let recovery: string[] = [];
  beforeAll(async () => { u = await registerAccount(ctx, 'mfaUser'); });

  it('enrolment shows the secret once, stores it encrypted, and only enables after a correct code', async () => {
    const start = await ctx.http().post('/security/mfa/enroll').set(auth(u.accessToken)).send({});
    secret = start.body.secret; expect(start.body.otpauthUri).toContain(`secret=${secret}`);
    expect((await ctx.http().get('/security/mfa').set(auth(u.accessToken))).body).toMatchObject({ enabled: false, enrollmentPending: true });
    // not enabled yet: password login still gives a session
    expect((await login(u.email)).body.accessToken).toBeTruthy();
    expect((await ctx.http().post('/security/mfa/confirm').set(auth(u.accessToken)).send({ code: '000000' })).status).toBe(401);
    const row = (await owner$.query("SELECT ciphertext, key_id FROM mfa_credentials WHERE subject_id = $1", [u.userId])).rows[0];
    expect(JSON.stringify(row)).not.toContain(secret); expect(row.key_id).toBe('local-1');
    const ok = await ctx.http().post('/security/mfa/confirm').set(auth(u.accessToken)).send({ code: codeAt(secret) });
    expect(ok.status).toBe(200); recovery = ok.body.recoveryCodes; expect(recovery).toHaveLength(10);
    expect((await ctx.http().get('/security/mfa').set(auth(u.accessToken))).body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    expect((await owner$.query("SELECT count(*)::int n FROM mfa_recovery_codes WHERE subject_id = $1 AND code_hash LIKE '%-%'", [u.userId])).rows[0].n).toBe(0); // hashed, not plaintext
    expect((await ctx.http().post('/security/mfa/enroll').set(auth(u.accessToken)).send({})).status).toBe(409);
  });

  it('password alone no longer opens a session: login returns a challenge, the code completes it', async () => {
    const r = await login(u.email);
    expect(r.status).toBe(200); expect(r.body.mfaRequired).toBe(true); expect(r.body.accessToken).toBeUndefined(); expect(r.headers['set-cookie']).toBeUndefined();
    const challenge = r.body.challengeToken as string;
    expect((await ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, code: '123456' })).status).toBe(401);
    expect((await ctx.http().post('/auth/mfa/verify').send({ challengeToken: 'garbage.token.value-garbage-garbage', code: codeAt(secret, 1) })).status).toBe(401);
    // a wrong password still gets no challenge at all
    expect((await ctx.http().post('/auth/login').send({ email: u.email, password: 'Wrong-Passw0rd!' })).status).toBe(401);
    const done = await ctx.http().post('/auth/mfa/verify').set('x-token-delivery', 'body').send({ challengeToken: challenge, code: codeAt(secret, 1) }); // next step: inside the skew window
    expect(done.status).toBe(200); expect(done.body.accessToken).toBeTruthy();
    expect((await ctx.http().get('/leads').set(auth(done.body.accessToken))).status).toBe(200);
  });

  it('a code cannot be replayed, even once, and an older step cannot be used after a newer one', async () => {
    const challenge = (await login(u.email)).body.challengeToken as string;
    const code = codeAt(secret, 1); // newer than the one used above? use step+1 then the same again
    const sameStepAsBefore = await ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, code });
    expect(sameStepAsBefore.status).toBe(401); // step+1 was consumed by the previous test
    const next = await ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, code: codeAt(secret, 0) });
    expect(next.status).toBe(401); // older than the last accepted step
  });

  it('recovery codes work once each, and a used one is dead', async () => {
    const c1 = recovery[0] as string; const challenge = (await login(u.email)).body.challengeToken as string;
    const first = await ctx.http().post('/auth/mfa/verify').set('x-token-delivery', 'body').send({ challengeToken: challenge, recoveryCode: c1 });
    expect(first.status).toBe(200); expect(first.body.accessToken).toBeTruthy();
    expect((await ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, recoveryCode: c1 })).status).toBe(401);
    expect((await ctx.http().get('/security/mfa').set(auth(first.body.accessToken))).body.recoveryCodesRemaining).toBe(9);
    // two simultaneous attempts with the same fresh code: exactly one wins
    const c2 = recovery[1] as string;
    const res = await Promise.all([0, 1].map(() => ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, recoveryCode: c2 })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('locks after repeated wrong codes (even a correct code is refused while locked) and records audit events', async () => {
    await owner$.query("UPDATE mfa_credentials SET failed_attempts = 0, locked_until = NULL WHERE subject_id = $1", [u.userId]); // earlier tests left a few failures on the counter
    const challenge = (await login(u.email)).body.challengeToken as string;
    for (let i = 0; i < 5; i++) expect((await ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, code: '000000' })).status).toBe(401);
    const locked = await ctx.http().post('/auth/mfa/verify').send({ challengeToken: challenge, code: codeAt(secret, 1) });
    expect(locked.status).toBe(429); expect(locked.body.error.code).toBe('mfa_locked');
    const actions = (await owner$.query("SELECT action FROM audit_logs WHERE actor_user_id = $1 AND action LIKE 'auth.mfa%'", [u.userId])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.mfa_enabled', 'auth.mfa_failed', 'auth.mfa_recovery_code_used']));
    await owner$.query("UPDATE mfa_credentials SET locked_until = NULL, failed_attempts = 0 WHERE subject_id = $1", [u.userId]);
  });

  it('turning it off or regenerating codes needs a current code; then password login is enough again', async () => {
    const s = await (async () => { const c = (await login(u.email)).body.challengeToken as string; return ctx.http().post('/auth/mfa/verify').set('x-token-delivery', 'body').send({ challengeToken: c, code: codeAt(secret, 1) }); })();
    // step+1 consumed earlier; use the next step (within +1 skew only if time advanced) -> fall back to a recovery code
    const token = s.status === 200 ? s.body.accessToken as string : (await ctx.http().post('/auth/mfa/verify').set('x-token-delivery', 'body').send({ challengeToken: (await login(u.email)).body.challengeToken, recoveryCode: recovery[2] })).body.accessToken as string;
    expect((await ctx.http().post('/security/mfa/disable').set(auth(token)).send({ code: '111111' })).status).toBe(401);
    const regen = await ctx.http().post('/security/mfa/recovery-codes').set(auth(token)).send({ recoveryCode: recovery[3] });
    expect(regen.status).toBe(200); expect(regen.body.recoveryCodes).toHaveLength(10);
    expect((await ctx.http().post('/auth/mfa/verify').send({ challengeToken: (await login(u.email)).body.challengeToken, recoveryCode: recovery[4] })).status).toBe(401); // old set is gone
    expect((await ctx.http().post('/security/mfa/disable').set(auth(token)).send({ recoveryCode: (regen.body.recoveryCodes as string[])[0] })).status).toBe(204);
    expect((await login(u.email)).body.accessToken).toBeTruthy();
    expect((await owner$.query("SELECT count(*)::int n FROM mfa_credentials WHERE subject_id = $1", [u.userId])).rows[0].n).toBe(0);
  });
});

describe('workspace policy: require MFA', () => {
  it('needs the owner to be enrolled first, then holds un-enrolled members at the Security page until they enrol', async () => {
    const o = await registerAccount(ctx, 'mfaOwner');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', o.email)?.token });
    const member = await addMember(ctx, o, 'mfaMember', 'agent');
    expect((await ctx.http().put('/security/workspace').set(auth(o.accessToken)).send({ requireMfa: true })).body.error.code).toBe('enroll_first');
    const e = await enrol(o.accessToken);
    expect((await ctx.http().put('/security/workspace').set(auth(member.accessToken)).send({ requireMfa: true })).status).toBe(403); // agents cannot change policy
    expect((await ctx.http().put('/security/workspace').set(auth(o.accessToken)).send({ requireMfa: true })).status).toBe(200);
    const blocked = await ctx.http().get('/leads').set(auth(member.accessToken));
    expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('mfa_enrollment_required');
    expect((await ctx.http().get('/auth/me').set(auth(member.accessToken))).status).toBe(200);
    expect((await ctx.http().get('/security/mfa').set(auth(member.accessToken))).body.workspaceRequiresMfa).toBe(true);
    expect((await ctx.http().get('/leads').set(auth(o.accessToken))).status).toBe(200); // the enrolled owner is fine
    await enrol(member.accessToken);
    expect((await ctx.http().get('/leads').set(auth(member.accessToken))).status).toBe(200);
    // nobody can switch it off while the workspace requires it
    const off = await ctx.http().post('/security/mfa/disable').set(auth(member.accessToken)).send({ recoveryCode: e.recoveryCodes[0] });
    expect(off.status).toBe(409); expect(off.body.error.code).toBe('mfa_required_by_workspace');
  });
});

describe('platform admin MFA', () => {
  const email = `it-${RUN}-pmfa@example.test`; const P = '/platform';
  let token = ''; let adminId = '';
  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    adminId = (await owner$.query("INSERT INTO platform_admins (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, $2, 'MFA Admin') RETURNING id", [email, hash])).rows[0].id as string;
    const r = await ctx.http().post(`${P}/auth/login`).send({ email, password: PASSWORD });
    token = (r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lp_platform='))?.split(';')[0]?.split('=')[1] ?? '';
  });
  it('enrols, then the console needs the second step; tenant tokens and challenges do not cross over', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const start = await ctx.http().post(`${P}/security/mfa/enroll`).set(h).send({});
    const secret = start.body.secret as string;
    const conf = await ctx.http().post(`${P}/security/mfa/confirm`).set(h).send({ code: codeAt(secret) });
    expect(conf.status).toBe(200); expect(conf.body.recoveryCodes).toHaveLength(10);

    const step1 = await ctx.http().post(`${P}/auth/login`).send({ email, password: PASSWORD });
    expect(step1.body.mfaRequired).toBe(true); expect(step1.headers['set-cookie']).toBeUndefined();
    expect((await ctx.http().post(`${P}/auth/mfa`).send({ challengeToken: step1.body.challengeToken, code: '000000' })).status).toBe(401);
    const step2 = await ctx.http().post(`${P}/auth/mfa`).send({ challengeToken: step1.body.challengeToken, code: codeAt(secret, 1) });
    expect(step2.status).toBe(200); expect((step2.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('lp_platform='))).toBe(true);
    // a TENANT-side challenge for a user cannot be used on the platform endpoint (different audience and secret)
    const u = await registerAccount(ctx, 'mfaCross'); await enrol(u.accessToken);
    const tenantChallenge = (await login(u.email)).body.challengeToken as string;
    expect((await ctx.http().post(`${P}/auth/mfa`).send({ challengeToken: tenantChallenge, code: codeAt(secret, 1) })).status).toBe(401);
    expect((await ctx.http().post('/auth/mfa/verify').send({ challengeToken: step1.body.challengeToken, code: codeAt(secret, 1) })).status).toBe(401);
    // recovery code path + audit on the platform log
    const step1b = await ctx.http().post(`${P}/auth/login`).send({ email, password: PASSWORD });
    expect((await ctx.http().post(`${P}/auth/mfa`).send({ challengeToken: step1b.body.challengeToken, recoveryCode: (conf.body.recoveryCodes as string[])[0] })).status).toBe(200);
    const log = (await owner$.query("SELECT action FROM platform_audit_logs WHERE admin_id = $1", [adminId])).rows.map((r) => r.action);
    expect(log).toEqual(expect.arrayContaining(['auth.mfa_enabled', 'auth.mfa_failed', 'auth.mfa_recovery_code_used', 'platform.login']));
  });
});
