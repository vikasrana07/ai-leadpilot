import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { MOCK_PASS_TOKEN, TurnstileService } from '../src/security/turnstile.js';
import { auth, cleanup, createTestApp, type TestCtx } from './helpers.js';

const baseEnv = { WEB_ORIGIN: 'http://x.test', DATABASE_URL: 'postgresql://a:b@h/d', JWT_ACCESS_SECRET: 'x'.repeat(40), LOCAL_MASTER_KEY: Buffer.alloc(32, 3).toString('base64') };
const svc = (o: Record<string, string>) => new TurnstileService(loadEnv({ ...baseEnv, ...o }));

describe('Turnstile verification (unit)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('off: allows everything; mock: only the literal mock token', async () => {
    expect(await svc({}).verify(undefined, '1.1.1.1')).toBe(true);
    const mock = svc({ TURNSTILE_MODE: 'mock' });
    expect(await mock.verify(MOCK_PASS_TOKEN, undefined)).toBe(true);
    expect(await mock.verify('anything-else', undefined)).toBe(false);
    expect(await mock.verify(undefined, undefined)).toBe(false);
    expect(await mock.verify('x'.repeat(5000), undefined)).toBe(false);
  });

  const live = { TURNSTILE_MODE: 'live', TURNSTILE_SECRET: 's3cret', TURNSTILE_SITE_KEY: '0xAAAA' };
  it('live: posts secret, token and ip to Cloudflare and trusts only success:true', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })); vi.stubGlobal('fetch', f);
    expect(await svc(live).verify('tok', '9.9.9.9')).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: URLSearchParams }];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify'); expect(init.method).toBe('POST');
    expect(init.body.get('secret')).toBe('s3cret'); expect(init.body.get('response')).toBe('tok'); expect(init.body.get('remoteip')).toBe('9.9.9.9');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 })));
    expect(await svc(live).verify('bad', undefined)).toBe(false);
  });

  it('live: FAILS CLOSED on a missing token, HTTP errors, malformed bodies, network errors and timeouts', async () => {
    const t = svc(live);
    expect(await t.verify(undefined, undefined)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 }))); expect(await t.verify('tok', undefined)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 }))); expect(await t.verify('tok', undefined)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); })); expect(await t.verify('tok', undefined)).toBe(false);
    vi.stubGlobal('fetch', vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))))));
    vi.useFakeTimers(); const p = t.verify('tok', undefined); await vi.advanceTimersByTimeAsync(5100); expect(await p).toBe(false); vi.useRealTimers();
  });

  it('production refuses off/mock unless the risk is explicitly accepted, and live needs its keys', () => {
    const prod = { ...baseEnv, NODE_ENV: 'production', TRACKING_SECRET: 't'.repeat(32), KEY_PROVIDER: 'kms', KMS_KEY_ID: 'k', RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b', RAZORPAY_WEBHOOK_SECRET: 'c'.repeat(20), SELLER_GSTIN: '29ABCDE1234F1Z5', WHATSAPP_MODE: 'live', VIRUS_SCAN_MODE: 'clamav', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk' };
    expect(() => loadEnv(prod)).toThrow(/TURNSTILE_MODE=off is not allowed in production/);
    expect(() => loadEnv({ ...prod, TURNSTILE_MODE: 'mock' })).toThrow(/mock bot check/);
    expect(() => loadEnv({ ...prod, TURNSTILE_MODE: 'live' })).toThrow(/TURNSTILE_SECRET/);
    expect(() => loadEnv({ ...prod, TURNSTILE_MODE: 'off', TURNSTILE_ALLOW_OFF_IN_PRODUCTION: 'true' })).not.toThrow();
    expect(() => loadEnv({ ...prod, TURNSTILE_MODE: 'live', TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k' })).not.toThrow();
  });
});

describe('bot check on public routes (integration, mock mode)', () => {
  let ctx: TestCtx;
  beforeAll(async () => { process.env.TURNSTILE_MODE = 'mock'; process.env.THROTTLE_AUTH_LIMIT = '4'; ctx = await createTestApp(); });
  afterAll(async () => { delete process.env.TURNSTILE_MODE; process.env.THROTTLE_AUTH_LIMIT = '1000'; await ctx.close(); await cleanup(); });

  it('login, register and forgot-password need a valid token; the check runs before any credential work', async () => {
    for (const [path, body] of [['/auth/login', { email: 'nobody@example.test', password: 'whatever-password' }], ['/auth/forgot-password', { email: 'nobody@example.test' }]] as const) {
      const none = await ctx.http().post(path).send(body); expect(none.status, path).toBe(403); expect(none.body.error.code).toBe('bot_check_failed');
      expect((await ctx.http().post(path).set('x-turnstile-token', 'forged').send(body)).status, path).toBe(403);
    }
    expect((await ctx.http().post('/auth/login').set('x-turnstile-token', MOCK_PASS_TOKEN).send({ email: 'nobody@example.test', password: 'whatever-password' })).status).toBe(401); // passed the bot check, failed credentials
    expect((await ctx.http().post('/auth/register').send({ name: 'Bot', email: 'bot@example.test', password: 'Str0ngPassw0rd!', businessName: 'Bot Biz' })).status).toBe(403);
  });

  it('rate limiting still applies on top of a valid token', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await ctx.http().post('/auth/login').set('x-turnstile-token', MOCK_PASS_TOKEN).send({ email: 'rl@example.test', password: 'whatever-password' })).status);
    expect(statuses).toContain(429);
  });

  it('authenticated routes are unaffected, and widget session creation is gated before any lookup', async () => {
    process.env.THROTTLE_AUTH_LIMIT = '1000';
    const a = await registerWithToken();
    expect((await ctx.http().get('/auth/me').set(auth(a))).status).toBe(200);
    const w = await ctx.http().post('/widget/sessions').send({ key: 'pk_doesnotexist12345', name: 'x', phone: '+919800000000' });
    expect(w.status).toBe(403); expect(w.body.error.code).toBe('bot_check_failed'); // blocked before the widget lookup
  });

  async function registerWithToken(): Promise<string> {
    const email = `it-bot-${Date.now()}@example.test`;
    const r = await ctx.http().post('/auth/register').set('x-token-delivery', 'body').set('x-turnstile-token', MOCK_PASS_TOKEN).send({ name: 'Bot Test', email, password: 'Str0ngPassw0rd!', businessName: 'Bot Biz', industry: 'real_estate' });
    expect(r.status).toBe(201);
    return r.body.accessToken as string;
  }
});
