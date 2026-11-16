import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, previousRange, resolveRange, startOfDay } from '../src/analytics/date-range.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

describe('date ranges (tenant timezone)', () => {
  it('starts days at local midnight in Asia/Kolkata (UTC+5:30)', () => {
    expect(startOfDay(new Date('2026-11-16T20:00:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-11-16T18:30:00.000Z'); // 17 Nov 01:30 IST => 17 Nov 00:00 IST
    expect(startOfDay(new Date('2026-11-16T10:00:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });
  it('keeps calendar-day boundaries across a DST change (23h day)', () => {
    const start = startOfDay(new Date('2026-03-08T15:00:00Z'), 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    const next = addDays(start, 1, 'America/New_York');
    expect(next.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect((next.getTime() - start.getTime()) / 3600_000).toBe(23);
  });
  it('resolves named ranges and a previous period of equal length', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    const r7 = resolveRange({ range: '7d' }, 'Asia/Kolkata', now);
    expect(r7.to.getTime() - r7.from.getTime()).toBe(7 * 86_400_000);
    const prev = previousRange(r7);
    expect(prev.to.getTime()).toBe(r7.from.getTime());
    expect(prev.to.getTime() - prev.from.getTime()).toBe(7 * 86_400_000);
    const month = resolveRange({ range: 'month' }, 'Asia/Kolkata', now);
    expect(month.from.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(month.to.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    const custom = resolveRange({ range: 'custom', from: '2026-11-10T00:00:00Z', to: '2026-11-12T00:00:00Z' }, 'UTC', now);
    expect((custom.to.getTime() - custom.from.getTime()) / 86_400_000).toBe(3);
  });
});

let ctx: TestCtx; let owner: Account; let other: Account; let agent: Account;
let stages: Record<string, string> = {};
const mk = (t: Account, body: Record<string, unknown>) => ctx.http().post('/leads').set(auth(t.accessToken)).send(body);

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'xOwner'); other = await registerAccount(ctx, 'xOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'xAgent', 'agent');
  const s = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
  stages = Object.fromEntries(s.body.stages.map((x: { key: string; id: string }) => [x.key, x.id]));
});
afterAll(async () => { await ctx.close(); await cleanup(); });

describe('property inventory', () => {
  it('manages properties, validates input and is tenant-scoped', async () => {
    const p = await ctx.http().post('/properties').set(auth(owner.accessToken)).send({ project: 'Greenfield Heights', unitLabel: 'A-1204', title: '3 BHK in Wakad', propertyType: 'Apartment', bedrooms: 3, areaSqft: 1250, price: 11_200_000, location: 'Wakad, Pune' });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ price: 11_200_000, status: 'AVAILABLE' });
    expect((await ctx.http().post('/properties').set(auth(owner.accessToken)).send({ project: '', price: -5 })).status).toBe(400);
    const list = await ctx.http().get('/properties?minPrice=10000000&maxPrice=12000000&bedrooms=3&q=wakad').set(auth(agent.accessToken));
    expect(list.body.total).toBe(1);
    expect((await ctx.http().get('/properties?maxPrice=5000000').set(auth(owner.accessToken))).body.total).toBe(0);
    expect((await ctx.http().get('/properties').set(auth(other.accessToken))).body.total).toBe(0);
    expect((await ctx.http().patch(`/properties/${p.body.id}`).set(auth(other.accessToken)).send({ status: 'SOLD' })).status).toBe(404);
    expect((await ctx.http().patch(`/properties/${p.body.id}`).set(auth(agent.accessToken)).send({ status: 'SOLD' })).status).toBe(403); // agents read only
    expect((await ctx.http().patch(`/properties/${p.body.id}`).set(auth(owner.accessToken)).send({ status: 'SOLD' })).body.status).toBe('SOLD');
    expect((await ctx.http().delete(`/properties/${p.body.id}`).set(auth(owner.accessToken))).status).toBe(204);
    expect((await ctx.http().get('/properties').set(auth(owner.accessToken))).body.total).toBe(0);
  });
  it('imports a CSV with a dry-run report first', async () => {
    const csv = 'Project,Unit,BHK,Area,Price,Location,Status\nSunrise,B-101,2 BHK,950,85 L,Baner,Available\nSunrise,B-102,3 BHK,1300,₹1.2 Cr,Baner,Held\nSunrise,B-103,2,900,free,Baner,Available\nSunrise,B-104,2,900,80L,Baner,Gone';
    const dry = await ctx.http().post('/properties/import').set(auth(owner.accessToken)).send({ csv, dryRun: true });
    expect(dry.body).toMatchObject({ valid: 2, created: 0 });
    expect(dry.body.invalid.map((i: { row: number }) => i.row)).toEqual([4, 5]);
    const real = await ctx.http().post('/properties/import').set(auth(owner.accessToken)).send({ csv, dryRun: false });
    expect(real.body.created).toBe(2);
    const list = await ctx.http().get('/properties?status=HELD').set(auth(owner.accessToken));
    expect(list.body.items[0]).toMatchObject({ price: 12_000_000, bedrooms: 3, areaSqft: 1300 });
  });
});

describe('API-key lead capture', () => {
  let key: string; let keyId: string;
  it('issues a key once, lists only the prefix, and requires integration:manage', async () => {
    expect((await ctx.http().post('/api-keys').set(auth(agent.accessToken)).send({ name: 'x' })).status).toBe(403);
    const created = await ctx.http().post('/api-keys').set(auth(owner.accessToken)).send({ name: 'Website form' });
    expect(created.status).toBe(201);
    key = created.body.key; keyId = created.body.id;
    expect(key).toMatch(/^lp_live_/);
    const list = await ctx.http().get('/api-keys').set(auth(owner.accessToken));
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body[0].keyPrefix).toBe(key.slice(0, 12));
  });
  it('creates a lead in the key\'s own tenant with source "api", and merges repeat enquiries', async () => {
    const r = await ctx.http().post('/public/leads').set('x-api-key', key).send({ name: 'Web Enquirer', phone: '9944400001', message: 'Interested in 3BHK', location: 'Baner', budgetMax: 9_000_000 });
    expect(r.status).toBe(201);
    expect(r.body.duplicate).toBe(false);
    const lead = await ctx.http().get(`/leads/${r.body.id}`).set(auth(owner.accessToken));
    expect(lead.body).toMatchObject({ name: 'Web Enquirer', requirements: 'Interested in 3BHK', source: { key: 'api' }, stage: { key: 'new' } });
    expect((await ctx.http().get(`/leads/${r.body.id}`).set(auth(other.accessToken))).status).toBe(404);
    const again = await ctx.http().post('/public/leads').set('x-api-key', key).send({ name: 'Web Enquirer', phone: '+91 99444 00001', message: 'Calling again' });
    expect(again.body).toEqual({ id: r.body.id, duplicate: true });
    const tl = await ctx.http().get(`/leads/${r.body.id}/activity`).set(auth(owner.accessToken));
    expect(tl.body.map((a: { type: string }) => a.type)).toContain('enquiry_received');
    expect((await ctx.http().get('/leads?q=Web Enquirer').set(auth(owner.accessToken))).body.total).toBe(1);
  });
  it('rejects missing, malformed, wrong and revoked keys with the same error, and validates input', async () => {
    for (const k of [undefined, 'nope', 'lp_live_' + 'x'.repeat(32)]) {
      const r = await ctx.http().post('/public/leads').set(k ? { 'x-api-key': k } : {}).send({ name: 'A', phone: '9000000001' });
      expect(r.status).toBe(401); expect(r.body.error.code).toBe('invalid_api_key');
    }
    expect((await ctx.http().post('/public/leads').set('x-api-key', key).send({ name: 'No Contact' })).status).toBe(400);
    expect((await ctx.http().delete(`/api-keys/${keyId}`).set(auth(other.accessToken))).status).toBe(404);
    expect((await ctx.http().delete(`/api-keys/${keyId}`).set(auth(owner.accessToken))).status).toBe(204);
    expect((await ctx.http().post('/public/leads').set('x-api-key', key).send({ name: 'Late', phone: '9944400009' })).status).toBe(401);
  });
  it('a session token cannot be used as an API key and an API key cannot call private endpoints', async () => {
    expect((await ctx.http().post('/public/leads').set('x-api-key', owner.accessToken).send({ name: 'A', phone: '9000000002' })).status).toBe(401);
    const k2 = (await ctx.http().post('/api-keys').set(auth(owner.accessToken)).send({ name: 'k2' })).body.key;
    expect((await ctx.http().get('/leads').set('x-api-key', k2)).status).toBe(401);
    expect((await ctx.http().get('/leads').set(auth(k2))).status).toBe(401);
  });
});

describe('dashboard analytics (verified against a known fixture)', () => {
  let a: Account;
  beforeAll(async () => {
    a = await registerAccount(ctx, 'xFixture');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', a.email)?.token });
    const st = (await ctx.http().get('/pipeline/stages').set(auth(a.accessToken))).body.stages;
    const m = Object.fromEntries(st.map((x: { key: string; id: string }) => [x.key, x.id]));
    // fixture: 6 leads. 2 qualified, 1 won, 1 lost, 2 HOT (one open, one won), sources: manual x4, api x2 (via csv)
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await mk(a, { name: `Fx ${i}`, phone: `9955500${i}01`, ...(i < 2 ? { budgetMax: 9_000_000, location: 'Baner', propertyType: '2 BHK apartment', requirements: 'Wants a quiet society near a school', buyingTimeline: 'WITHIN_30_DAYS' } : {}) })).body.id);
    const mv = (id: string, key: string, extra: object = {}) => ctx.http().post(`/leads/${id}/stage`).set(auth(a.accessToken)).send({ stageId: m[key], ...extra });
    await mv(ids[0] as string, 'qualified');
    await mv(ids[1] as string, 'negotiation'); await mv(ids[1] as string, 'won');
    await mv(ids[2] as string, 'qualified');
    const reason = (await ctx.http().get('/pipeline/stages').set(auth(a.accessToken))).body.lostReasons[0].id;
    await mv(ids[3] as string, 'lost', { lostReasonId: reason });
    await ctx.http().post('/leads/import').set(auth(a.accessToken)).send({ csv: 'name,phone,source\nFx 6,9955500601,api\nFx 7,9955500701,api', dryRun: false });
  });
  it('matches the fixture exactly', async () => {
    const r = await ctx.http().get('/analytics/overview?range=30d').set(auth(a.accessToken));
    expect(r.status).toBe(200);
    const k = r.body.kpis;
    expect(k.totalLeads.value).toBe(8);
    expect(k.newLeads.value).toBe(8);
    expect(k.qualifiedLeads.value).toBe(3);   // two at Qualified + one Won
    expect(k.hotLeads.value).toBe(1);          // one HOT open (the other HOT lead is Won)
    expect(k.converted.value).toBe(1);
    expect(k.conversionRate.value).toBe(12.5); // 1 won of 8 created
    expect(k.appointmentsBooked).toBeNull();   // never fabricated
    expect(r.body.trend.reduce((s: number, d: { leads: number }) => s + d.leads, 0)).toBe(8);
    expect(r.body.pipeline.find((p: { stage: string }) => p.stage === 'Qualified').count).toBe(2);
    expect(r.body.pipeline.find((p: { stage: string }) => p.stage === 'Won').count).toBe(1);
    expect(r.body.sources.find((s: { name: string }) => s.name === 'API / form')).toMatchObject({ leads: 2, won: 0 });
    expect(r.body.sources.find((s: { name: string }) => s.name === 'Added manually')).toMatchObject({ leads: 6, won: 1 });
    expect(r.body.hotLeads).toHaveLength(1);
    expect(r.body.recentLeads).toHaveLength(5);
  });
  it('supports ranges, validates custom ranges, and does not leak across tenants', async () => {
    expect((await ctx.http().get('/analytics/overview?range=yesterday').set(auth(a.accessToken))).body.kpis.newLeads.value).toBe(0);
    expect((await ctx.http().get('/analytics/overview?range=today').set(auth(a.accessToken))).body.kpis.newLeads.value).toBe(8);
    expect((await ctx.http().get('/analytics/overview?range=custom').set(auth(a.accessToken))).status).toBe(400);
    const c = await ctx.http().get(`/analytics/overview?range=custom&from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date().toISOString()}`).set(auth(a.accessToken));
    expect(c.body.kpis.newLeads.value).toBe(8);
    expect((await ctx.http().get('/analytics/overview?range=30d').set(auth(other.accessToken))).body.kpis.totalLeads.value).toBe(0);
  });
  it('agents see analytics for their own leads only, and no team data', async () => {
    const r = await ctx.http().get('/analytics/overview?range=30d').set(auth(agent.accessToken));
    expect(r.status).toBe(200);
    expect(r.body.kpis.totalLeads.value).toBe((await ctx.http().get('/leads?pageSize=1').set(auth(agent.accessToken))).body.total);
    expect(r.body.agents).toEqual([]);
    expect((await ctx.http().get('/team/workload').set(auth(agent.accessToken))).status).toBe(403);
  });
  it('reports team workload including unassigned leads', async () => {
    const w = await ctx.http().get('/team/workload').set(auth(a.accessToken));
    expect(w.status).toBe(200);
    expect(w.body.unassignedOpenLeads).toBeGreaterThan(0);
    expect(w.body.members[0]).toMatchObject({ role: 'Business Owner' });
  });
});

describe('pipeline configuration', () => {
  it('lets managers of the pipeline add, rename, reorder and delete empty stages with guard rails', async () => {
    const b = await ctx.http().post('/pipeline/stages').set(auth(owner.accessToken)).send({ name: 'Documentation', qualifies: true, canCloseWon: true });
    expect(b.status).toBe(201);
    const list = (await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken))).body.stages;
    expect(list.map((s: { name: string }) => s.name).slice(-3)).toEqual(['Documentation', 'Won', 'Lost']);
    expect((await ctx.http().patch(`/pipeline/stages/${b.body.id}`).set(auth(owner.accessToken)).send({ name: 'Paperwork' })).body.name).toBe('Paperwork');
    const ids = list.map((s: { id: string }) => s.id);
    const bad = [...ids].reverse();
    expect((await ctx.http().post('/pipeline/stages/reorder').set(auth(owner.accessToken)).send({ ids: bad })).body.error.code).toBe('invalid_order');
    expect((await ctx.http().delete(`/pipeline/stages/${list.find((s: { kind: string }) => s.kind === 'WON').id}`).set(auth(owner.accessToken))).body.error.code).toBe('stage_protected');
    const lead = (await mk(owner, { name: 'In Docs', phone: '9966600001' })).body;
    await ctx.http().post(`/leads/${lead.id}/stage`).set(auth(owner.accessToken)).send({ stageId: b.body.id });
    expect((await ctx.http().delete(`/pipeline/stages/${b.body.id}`).set(auth(owner.accessToken))).body.error.code).toBe('stage_in_use');
    await ctx.http().post(`/leads/${lead.id}/stage`).set(auth(owner.accessToken)).send({ stageId: stages.new });
    expect((await ctx.http().delete(`/pipeline/stages/${b.body.id}`).set(auth(owner.accessToken))).status).toBe(204);
    expect((await ctx.http().post('/pipeline/stages').set(auth(agent.accessToken)).send({ name: 'Nope' })).status).toBe(403);
    expect((await ctx.http().patch(`/pipeline/stages/${stages.new}`).set(auth(other.accessToken)).send({ name: 'pwned' })).status).toBe(404);
  });
  it('serves a board scoped to what the caller may see', async () => {
    const ownerBoard = await ctx.http().get('/pipeline/board').set(auth(owner.accessToken));
    expect(ownerBoard.body.columns.length).toBeGreaterThanOrEqual(8);
    const agentBoard = await ctx.http().get('/pipeline/board').set(auth(agent.accessToken));
    const agentTotal = agentBoard.body.columns.reduce((s: number, c: { total: number }) => s + c.total, 0);
    expect(agentTotal).toBe((await ctx.http().get('/leads?pageSize=1').set(auth(agent.accessToken))).body.total);
  });
});
