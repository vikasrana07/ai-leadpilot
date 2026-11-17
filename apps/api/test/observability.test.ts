import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { addLogContext, fingerprintError, getLogContext, installProcessHandlers, JsonLogger, loggerOptionsFromEnv, redact, redactValue, runWithLogContext } from '../src/observability/index.js';
import { auth, cleanup, createTestApp, registerAccount, type TestCtx } from './helpers.js';

describe('redact', () => {
  it('hides emails, phone numbers and identity numbers', () => {
    expect(redact('mail jane.doe+x@Example.co.in now')).toBe('mail [email] now');
    expect(redact('call +91 98765 43210 today')).toBe('call [phone] today');
    expect(redact('call +919876543210')).toBe('call [phone]');
    expect(redact('number 9876543210 failed')).toBe('number [number] failed');
    expect(redact('mobile 98765 43210')).toBe('mobile [phone]');
    expect(redact('pan ABCDE1234F and aadhaar 1234 5678 9012')).toBe('pan [pan] and aadhaar [id-number]');
    expect(redact('card 4111111111111111')).toBe('card [number]');
  });
  it('hides tokens, keys and secrets in values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    expect(redact(`token ${jwt} seen`)).toBe('token [jwt] seen');
    expect(redact('Bearer abc.def-ghi_jkl123456')).toBe('Bearer [redacted]');
    expect(redact('key lp_live_abcdefghijkl1234')).toBe('key [secret]');
    expect(redact('password=hunter2hunter2 ok')).toBe('password=[redacted] ok');
    expect(redact('{"token":"abc123def456"}')).toBe('{"token":"[redacted]"}');
    expect(redact(`hash ${'a1'.repeat(32)}`)).toBe('hash [hex]');
  });
  it('leaves ids, dates, routes and ordinary text readable', () => {
    for (const ok of [
      'request 0194b2f1-7c3e-7a11-8f10-123456789012 done', 'x-request-id req-1234.abcd_5678', '2026-11-17T10:30:00.000Z', 'POST /leads/:id/notes 500 in 12.3ms',
      'tenant 2f6a1c9e-0b1d-4c55-9d52-aaaaaaaaaaaa', 'Prisma error P2034 on appointment.create()', 'attempt 3 of 5', 'run 01939a3c-0000-7000-8000-000000000001 failed',
    ]) expect(redact(ok), ok).toBe(ok);
  });
  it('redacts nested values but keeps non-strings', () => {
    expect(redactValue({ a: 'x@y.com', n: 5, deep: { b: ['+919876543210'] } })).toEqual({ a: '[email]', n: 5, deep: { b: ['[phone]'] } });
  });
});

describe('fingerprintError', () => {
  const mk = (stack: string) => Object.assign(new Error('x'), { stack });
  it('is stable across line numbers and install paths, and ignores frames below the third', () => {
    const a = mk('Error: x\n    at foo (file:///srv/a/b/c.ts:10:5)\n    at bar (/srv/y/d.ts:20:1)\n    at baz (/srv/y/e.ts:3:3)\n    at deep (/srv/q.ts:1:1)');
    const b = mk('Error: x\n    at foo (/opt/app/b/c.ts:99:7)\n    at bar (/opt/y/d.ts:2:2)\n    at baz (/opt/y/e.ts:300:30)\n    at other (/opt/z.ts:5:5)');
    expect(fingerprintError(a)).toBe(fingerprintError(b));
    expect(fingerprintError(a)).toMatch(/^[0-9a-f]{12}$/);
  });
  it('differs for a different fault', () => {
    const a = mk('Error: x\n    at foo (/srv/c.ts:1:1)\n    at bar (/srv/d.ts:1:1)');
    const b = mk('Error: x\n    at foo2 (/srv/c.ts:1:1)\n    at bar (/srv/d.ts:1:1)');
    const c = Object.assign(new TypeError('x'), { stack: a.stack?.replace('Error:', 'TypeError:') });
    expect(fingerprintError(a)).not.toBe(fingerprintError(b));
    expect(fingerprintError(a)).not.toBe(fingerprintError(c));
  });
});

describe('JsonLogger', () => {
  const make = (over: Partial<ConstructorParameters<typeof JsonLogger>[0]> = {}) => { const lines: string[] = []; const logger = new JsonLogger({ format: 'json', level: 'log', write: (l) => lines.push(l), now: () => new Date('2026-11-17T10:00:00.000Z'), ...over }); return { logger, lines }; };

  it('writes one JSON object per line with level, context and redacted message', () => {
    const { logger, lines } = make();
    logger.log('hello jane@example.com', 'Billing');
    logger.warn('careful', 'Scanners');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toEqual({ ts: '2026-11-17T10:00:00.000Z', level: 'info', context: 'Billing', msg: 'hello [email]' });
    expect(JSON.parse(lines[1] as string).level).toBe('warn');
    expect(lines.every((l) => l.endsWith('\n') && l.trim().split('\n').length === 1)).toBe(true);
  });
  it('honours the level threshold', () => {
    const { logger, lines } = make({ level: 'warn' });
    logger.log('a'); logger.debug('b'); logger.verbose('c'); logger.warn('d'); logger.error('e'); logger.fatal('f');
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(['d', 'e', 'f']);
  });
  it('carries an error stack (redacted) and a fingerprint, and merges structured fields', () => {
    const { logger, lines } = make();
    const err = new Error('boom for +919876543210');
    logger.error({ msg: `failed: ${err.message}`, route: 'GET /x', fingerprint: fingerprintError(err), stack: err.stack }, 'HttpError');
    const o = JSON.parse(lines[0] as string);
    expect(o).toMatchObject({ level: 'error', context: 'HttpError', route: 'GET /x' });
    expect(o.msg).toBe('failed: boom for [phone]'); expect(o.stack).not.toContain('9876543210'); expect(o.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    logger.error(err); expect(JSON.parse(lines[1] as string).fingerprint).toMatch(/^[0-9a-f]{12}$/);
    logger.error('failed', 'Error: x\n    at a (/p/q.ts:1:1)', 'Jobs'); const o3 = JSON.parse(lines[2] as string); expect(o3.context).toBe('Jobs'); expect(o3.stack).toContain('at a');
  });
  it('mutes Nest boot chatter unless debug is on', () => {
    const quiet = make(); quiet.logger.log('Mapped {/x, GET} route', 'RouterExplorer'); quiet.logger.log('Nest application successfully started', 'NestApplication');
    expect(quiet.lines.map((l) => JSON.parse(l).context)).toEqual(['NestApplication']);
    const loud = make({ level: 'debug' }); loud.logger.log('Mapped {/x, GET} route', 'RouterExplorer'); expect(loud.lines).toHaveLength(1);
  });
  it('pretty format is a readable single line', () => {
    const { logger, lines } = make({ format: 'pretty' });
    runWithLogContext({ requestId: 'req-12345678' }, () => logger.log('hi', 'Boot'));
    expect(lines[0]).toBe('2026-11-17T10:00:00.000Z INFO  [Boot] hi (requestId=req-12345678)\n');
  });
  it('reads format and level from the environment', () => {
    expect(loggerOptionsFromEnv({ NODE_ENV: 'production' })).toEqual({ format: 'json', level: 'log' });
    expect(loggerOptionsFromEnv({ NODE_ENV: 'development' })).toEqual({ format: 'pretty', level: 'log' });
    expect(loggerOptionsFromEnv({ NODE_ENV: 'production', LOG_FORMAT: 'pretty', LOG_LEVEL: 'warn' })).toEqual({ format: 'pretty', level: 'warn' });
    expect(loggerOptionsFromEnv({ LOG_LEVEL: 'nonsense', LOG_FORMAT: 'xml' })).toEqual({ format: 'pretty', level: 'log' });
  });
});

describe('log context (AsyncLocalStorage)', () => {
  it('survives awaits, timers and promise chains, and is isolated per request', async () => {
    const lines: string[] = []; const logger = new JsonLogger({ format: 'json', level: 'log', write: (l) => lines.push(l) });
    const work = (id: string, ms: number) => runWithLogContext({ requestId: id }, async () => {
      await new Promise((r) => setTimeout(r, ms));
      addLogContext({ tenantId: `t-${id}`, userId: `u-${id}` });
      await Promise.resolve().then(() => logger.log('in chain', 'T'));
      expect(getLogContext()?.requestId).toBe(id);
    });
    await Promise.all([work('req-aaaaaaaa', 20), work('req-bbbbbbbb', 5)]);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.find((p) => p.requestId === 'req-aaaaaaaa')).toMatchObject({ tenantId: 't-req-aaaaaaaa', userId: 'u-req-aaaaaaaa' });
    expect(parsed.find((p) => p.requestId === 'req-bbbbbbbb')).toMatchObject({ tenantId: 't-req-bbbbbbbb' });
    expect(getLogContext()).toBeUndefined();
  });
  it('ignores addLogContext outside a context and empty values', () => {
    addLogContext({ tenantId: 'x' }); expect(getLogContext()).toBeUndefined();
    runWithLogContext({ requestId: 'r' }, () => { addLogContext({ tenantId: '' }); expect(getLogContext()).toEqual({ requestId: 'r' }); });
  });
});

describe('installProcessHandlers', () => {
  it('logs a redacted fatal line with a fingerprint, flushes, then exits 1 - once', async () => {
    const lines: string[] = []; const logger = new JsonLogger({ format: 'json', level: 'log', write: (l) => lines.push(l) });
    const handlers = new Map<string, (r: unknown) => void>();
    const exit = vi.fn(); const flush = vi.fn(async () => undefined);
    installProcessHandlers(logger, { exit, flush, proc: { on: (e, fn) => { handlers.set(e, fn as (r: unknown) => void); } } });
    expect([...handlers.keys()].sort()).toEqual(['uncaughtException', 'unhandledRejection']);
    handlers.get('unhandledRejection')?.(new Error('lost promise for jane@example.com'));
    handlers.get('uncaughtException')?.(new Error('second'));
    await new Promise((r) => setTimeout(r, 10));
    expect(lines).toHaveLength(1);
    const o = JSON.parse(lines[0] as string);
    expect(o).toMatchObject({ level: 'fatal', context: 'Process' }); expect(o.msg).toBe('unhandledRejection: lost promise for [email]'); expect(o.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(flush).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledWith(1);
  });
  it('copes with a non-Error rejection', async () => {
    const lines: string[] = []; const logger = new JsonLogger({ format: 'json', level: 'log', write: (l) => lines.push(l) });
    const handlers = new Map<string, (r: unknown) => void>(); const exit = vi.fn();
    installProcessHandlers(logger, { exit, flush: async () => undefined, proc: { on: (e, fn) => { handlers.set(e, fn as (r: unknown) => void); } } });
    handlers.get('unhandledRejection')?.('just a string'); await new Promise((r) => setTimeout(r, 10));
    expect(JSON.parse(lines[0] as string).msg).toBe('unhandledRejection: just a string'); expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('unexpected 500 over HTTP', () => {
  let ctx: TestCtx; const lines: string[] = [];
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { ctx.app.useLogger(new JsonLogger({ format: 'json', level: 'error', write: () => undefined })); await ctx.close(); await cleanup(); });

  it('logs one redacted JSON line with the request and user ids, and leaves the client response unchanged', async () => {
    const a = await registerAccount(ctx, 'obs500');
    ctx.app.useLogger(new JsonLogger({ format: 'json', level: 'log', write: (l) => lines.push(l) }));
    const spy = vi.spyOn(ctx.app.get(AuthService), 'buildContext').mockRejectedValueOnce(new Error('db exploded for jane.doe@example.com phone +919876543210 token=abcdef123456'));
    const res = await ctx.http().get('/auth/me').set(auth(a.accessToken)).set('x-request-id', 'req-obs-500-test');
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'internal_error', message: 'Something went wrong', requestId: 'req-obs-500-test' } });
    const errLines = lines.map((l) => JSON.parse(l)).filter((o) => o.context === 'HttpError');
    expect(errLines).toHaveLength(1);
    const o = errLines[0];
    expect(o).toMatchObject({ level: 'error', requestId: 'req-obs-500-test', userId: a.userId, route: 'GET /auth/me' });
    expect(o.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    const raw = lines.join('');
    for (const secret of ['jane.doe@example.com', '9876543210', 'abcdef123456']) expect(raw).not.toContain(secret);
    expect(o.msg).toContain('[email]'); expect(o.msg).toContain('[phone]');
    // a 4xx is not logged by the filter (the access log covers it)
    lines.length = 0;
    expect((await ctx.http().get('/auth/me')).status).toBe(401);
    expect(lines.map((l) => JSON.parse(l)).filter((x) => x.context === 'HttpError')).toHaveLength(0);
  });
});

describe('Logger static forwarding', () => {
  it('Nest Logger instances go through the installed logger', () => {
    const lines: string[] = [];
    Logger.overrideLogger(new JsonLogger({ format: 'json', level: 'log', write: (l) => lines.push(l) }));
    new Logger('Probe').error('as seen by jane@example.com');
    Logger.overrideLogger(false);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: 'error', context: 'Probe', msg: 'as seen by [email]' });
  });
});
