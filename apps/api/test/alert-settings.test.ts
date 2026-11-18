import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, PASSWORD, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let owner$: pg.Pool; let a: Account; let b: Account;
const get = (t: Account) => ctx.http().get('/me/alert-settings').set(auth(t.accessToken));
const put = (t: Account, body: unknown) => ctx.http().put('/me/alert-settings').set(auth(t.accessToken)).send(body as object);

beforeAll(async () => { ctx = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL }); a = await registerAccount(ctx, 'alA'); b = await registerAccount(ctx, 'alB'); });
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('alert settings (sound and desktop alerts)', () => {
  it('start at the defaults for someone who never changed them, and need a sign-in', async () => {
    const r = await get(a); expect(r.status).toBe(200); expect(r.body).toEqual({ soundEnabled: true, soundVolume: 50, desktopEnabled: true });
    expect((await owner$.query('SELECT 1 FROM user_alert_settings WHERE user_id = $1', [a.userId])).rows).toHaveLength(0); // reading never creates a row
    expect((await ctx.http().get('/me/alert-settings')).status).toBe(401);
    expect((await ctx.http().put('/me/alert-settings').send({ soundEnabled: false, soundVolume: 10, desktopEnabled: false })).status).toBe(401);
  });

  it('saves, reads back, can be changed again, and follows the person to a new sign-in', async () => {
    const r = await put(a, { soundEnabled: false, soundVolume: 80, desktopEnabled: false }); expect(r.status).toBe(200); expect(r.body).toEqual({ soundEnabled: false, soundVolume: 80, desktopEnabled: false });
    expect((await get(a)).body).toEqual({ soundEnabled: false, soundVolume: 80, desktopEnabled: false });
    expect((await put(a, { soundEnabled: true, soundVolume: 0, desktopEnabled: false })).status).toBe(200);
    expect((await get(a)).body).toEqual({ soundEnabled: true, soundVolume: 0, desktopEnabled: false });
    expect((await owner$.query('SELECT count(*)::int n FROM user_alert_settings WHERE user_id = $1', [a.userId])).rows[0].n).toBe(1); // one row per person, updated in place
    // a different browser or device is just another sign-in
    const login = await ctx.http().post('/auth/login').set('x-token-delivery', 'body').send({ email: a.email, password: PASSWORD }); expect(login.status).toBe(200);
    expect((await ctx.http().get('/me/alert-settings').set('authorization', `Bearer ${login.body.accessToken}`)).body).toEqual({ soundEnabled: true, soundVolume: 0, desktopEnabled: false });
  });

  it('is personal: one person\'s choice never shows for or changes another person\'s, whatever the request says', async () => {
    expect((await get(b)).body).toEqual({ soundEnabled: true, soundVolume: 50, desktopEnabled: true });
    const sneaky = await ctx.http().put('/me/alert-settings').set(auth(b.accessToken)).send({ soundEnabled: false, soundVolume: 5, desktopEnabled: false, userId: a.userId });
    expect(sneaky.status).toBe(200);
    expect((await get(a)).body).toEqual({ soundEnabled: true, soundVolume: 0, desktopEnabled: false });  // unchanged
    expect((await get(b)).body).toEqual({ soundEnabled: false, soundVolume: 5, desktopEnabled: false });
  });

  it('rejects anything that is not a yes/no and a whole volume from 0 to 100, saving nothing', async () => {
    const before = (await get(a)).body;
    for (const bad of [
      { soundEnabled: true, soundVolume: 101, desktopEnabled: true }, { soundEnabled: true, soundVolume: -1, desktopEnabled: true }, { soundEnabled: true, soundVolume: 50.5, desktopEnabled: true },
      { soundEnabled: true, soundVolume: '50', desktopEnabled: true }, { soundEnabled: 'yes', soundVolume: 50, desktopEnabled: true }, { soundEnabled: true, soundVolume: 50 },
      { soundVolume: 50, desktopEnabled: true }, {}, [], 'x',
    ]) expect((await put(a, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await get(a)).body).toEqual(before);
    for (const v of [0, 100]) expect((await put(a, { soundEnabled: true, soundVolume: v, desktopEnabled: true })).status).toBe(200); // the limits themselves are fine
  });

  it('the database refuses an out-of-range volume even if the API were bypassed, and the row goes when the person is deleted', async () => {
    await expect(owner$.query('UPDATE user_alert_settings SET sound_volume = 150 WHERE user_id = $1', [a.userId])).rejects.toThrow(/check/i);
    expect((await owner$.query('SELECT 1 FROM user_alert_settings WHERE user_id = $1', [b.userId])).rows).toHaveLength(1);
    await owner$.query('DELETE FROM sessions WHERE user_id = $1', [b.userId]); await owner$.query('DELETE FROM memberships WHERE user_id = $1', [b.userId]);
    await owner$.query('DELETE FROM users WHERE id = $1', [b.userId]);
    expect((await owner$.query('SELECT 1 FROM user_alert_settings WHERE user_id = $1', [b.userId])).rows).toHaveLength(0);
  });
});
