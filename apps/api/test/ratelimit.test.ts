import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, createTestApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => { process.env.THROTTLE_AUTH_LIMIT = '3'; ctx = await createTestApp(); });
afterAll(async () => { process.env.THROTTLE_AUTH_LIMIT = '1000'; await ctx.close(); await cleanup(); });

describe('rate limiting', () => {
  it('throttles repeated auth attempts with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await ctx.http().post('/auth/login').send({ email: 'nobody@example.test', password: 'whatever-password' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(3).every((s) => s === 429)).toBe(true);
  });
});
