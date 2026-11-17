import { industryChosen, packForIndustry } from '@leadpilot/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, type TestCtx } from './helpers.js';

describe('industry modules', () => {
  it('only real estate shows Properties; other industries fall back to the general pack without it', () => {
    expect(packForIndustry('real_estate').modules.properties).toBe(true);
    for (const i of ['home_services', 'coaching', 'healthcare', 'other', 'anything']) expect(packForIndustry(i).modules.properties, i).toBe(false);
  });

  it('industry counts as chosen only once onboarding completed that step', () => {
    expect(industryChosen({ step: 'business', completed: [], skipped: [] })).toBe(false);
    expect(industryChosen({ step: 'team', completed: ['business', 'industry'], skipped: [] })).toBe(true);
    expect(industryChosen({ step: 'team', completed: ['business', 'industry'], skipped: ['industry'] })).toBe(false);
    expect(industryChosen(null)).toBe(true);
  });

  describe('workspace summary', () => {
    let ctx: TestCtx;
    beforeAll(async () => { ctx = await createTestApp(); });
    afterAll(async () => { await ctx.close(); await cleanup(); });
    it('tells the web app which pack the workspace uses', async () => {
      const re = await registerAccount(ctx, 'modRe', 'real_estate');
      const hs = await registerAccount(ctx, 'modHs', 'home_services');
      const pack = async (t: string) => (await ctx.http().get('/auth/me').set(auth(t))).body.workspaces[0].industryPackId;
      expect(await pack(re.accessToken)).toBe('real_estate');
      const chosen = async (t: string) => (await ctx.http().get('/auth/me').set(auth(t))).body.workspaces[0].industryChosen;
      expect(await chosen(re.accessToken)).toBe(false); // fresh signup: nothing picked yet, so the menu must not assume an industry
      const done = await ctx.http().put('/tenant/onboarding').set(auth(re.accessToken)).send({ step: 'team', completed: ['business', 'industry'], skipped: [] });
      expect(done.status).toBe(200);
      expect(await chosen(re.accessToken)).toBe(true);
      expect(packForIndustry(await pack(hs.accessToken)).modules.properties).toBe(false);
    });
    it('switching industry in onboarding re-seeds the pipeline while there are no leads, and not after', async () => {
      const a = await registerAccount(ctx, 'modSwitch', 'real_estate');
      const keys = async () => ((await ctx.http().get('/pipeline/stages').set(auth(a.accessToken))).body.stages as { key: string }[]).map((x) => x.key);
      expect(await keys()).toContain('site_visit_scheduled');
      const patch = await ctx.http().patch('/tenant').set(auth(a.accessToken)).send({ industry: 'home_services' });
      expect(patch.status).toBe(200);
      expect(await keys()).not.toContain('site_visit_scheduled');
      expect(await keys()).toContain('quote_sent');
      expect((await ctx.http().get('/auth/me').set(auth(a.accessToken))).body.workspaces[0].industryPackId).toBe('home_services');
      // once a lead exists the pack is kept
      await ctx.http().post('/leads').set(auth(a.accessToken)).send({ name: 'Keep Me', phone: '+919811100001' });
      await ctx.http().patch('/tenant').set(auth(a.accessToken)).send({ industry: 'real_estate' });
      expect((await keys())).toContain('quote_sent');
      expect((await ctx.http().get('/auth/me').set(auth(a.accessToken))).body.workspaces[0].industryPackId).toBe('home_services');
    });
  });
});
