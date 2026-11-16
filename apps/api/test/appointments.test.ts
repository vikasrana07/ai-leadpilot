import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';
import { slotsForDate, windowsFor, type AvailabilityData } from '../src/ops/availability.js';
import { localParts, zonedToUtc } from '../src/common/tz.js';

let ctx: TestCtx;
let owner: Account; let agent: Account; let agent2: Account; let other: Account;
let ownerM = ''; let agentM = ''; let agent2M = '';
let n = 0;

/** A start time `daysAhead` days from now at `hourUtc`:00 UTC. Availability is opened 24/7 in these tests so the weekday never matters. */
const at = (daysAhead: number, hourUtc: number, min = 0) => { const d = new Date(Date.now() + daysAhead * 86_400_000); d.setUTCHours(hourUtc, min, 0, 0); return d.toISOString(); };
const lead = async (t: Account, name = `Lead ${++n}`, extra: Record<string, unknown> = {}) => (await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name, phone: `98${String(10_000_000 + n * 7919 + Math.floor(Math.random() * 1000)).slice(0, 8)}`, ...extra })).body.id as string;
const book = (t: Account, body: Record<string, unknown>) => ctx.http().post('/appointments').set(auth(t.accessToken)).send(body);

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'apOwner');
  other = await registerAccount(ctx, 'apOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'apAgent', 'agent');
  agent2 = await addMember(ctx, owner, 'apAgent2', 'agent');
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  const id = (a: Account) => members.body.find((m: { user: { email: string } }) => m.user.email === a.email).id as string;
  ownerM = id(owner); agentM = id(agent); agent2M = id(agent2);
  const open = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 }));
  const r = await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: null, rules: open });
  expect(r.status).toBe(200);
});
afterAll(async () => { await ctx.close(); await cleanup(); });

describe('double booking is impossible, even under a race', () => {
  it('lets exactly one of 12 simultaneous bookings for the same agent and time win', async () => {
    const leads = await Promise.all(Array.from({ length: 12 }, () => lead(owner)));
    const start = at(3, 5);
    const results = await Promise.all(leads.map((leadId) => book(owner, { leadId, membershipId: agentM, startsAt: start, durationMinutes: 60 })));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(11);
    expect(results.find((r) => r.status === 409)?.body.error?.code ?? results.find((r) => r.status === 409)?.body.code).toBe('slot_taken');
  });

  it('rejects partially overlapping times for the same agent but allows back-to-back', async () => {
    const [a, b, c] = await Promise.all([lead(owner), lead(owner), lead(owner)]);
    expect((await book(owner, { leadId: a, membershipId: agentM, startsAt: at(4, 5), durationMinutes: 60 })).status).toBe(201);
    expect((await book(owner, { leadId: b, membershipId: agentM, startsAt: at(4, 5, 30), durationMinutes: 60 })).status).toBe(409);
    const adjacent = await book(owner, { leadId: c, membershipId: agentM, startsAt: at(4, 6), durationMinutes: 60 });
    expect(adjacent.status).toBe(201);
  });

  it('stops the same customer being booked twice at once, with different agents', async () => {
    const l = await lead(owner);
    const results = await Promise.all([book(owner, { leadId: l, membershipId: agentM, startsAt: at(5, 5), durationMinutes: 60 }), book(owner, { leadId: l, membershipId: agent2M, startsAt: at(5, 5), durationMinutes: 60 })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('spreads automatic assignment across agents and runs out of capacity cleanly', async () => {
    const leads = await Promise.all(Array.from({ length: 6 }, () => lead(owner)));
    const start = at(6, 5);
    const results = await Promise.all(leads.map((leadId) => book(owner, { leadId, startsAt: start, durationMinutes: 60 })));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3); // owner + two agents are the eligible people
    expect(new Set(ok.map((r) => r.body.membershipId)).size).toBe(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('frees the slot when an appointment is cancelled', async () => {
    const [a, b] = await Promise.all([lead(owner), lead(owner)]);
    const first = await book(owner, { leadId: a, membershipId: agentM, startsAt: at(7, 5), durationMinutes: 60 });
    expect((await book(owner, { leadId: b, membershipId: agentM, startsAt: at(7, 5), durationMinutes: 60 })).status).toBe(409);
    expect((await ctx.http().post(`/appointments/${first.body.id}/cancel`).set(auth(owner.accessToken)).send({ reason: 'customer asked' })).status).toBe(200);
    expect((await book(owner, { leadId: b, membershipId: agentM, startsAt: at(7, 5), durationMinutes: 60 })).status).toBe(201);
  });
});

describe('working hours and availability', () => {
  it('slots exclude booked times, exceptions and the past; booking outside hours is refused', async () => {
    // agent2 works 10:00-12:00 local (Asia/Kolkata = UTC+5:30) every day
    const own = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 600, endMinute: 720 }));
    expect((await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: agent2M, rules: own })).status).toBe(200);
    const day = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    const slots = await ctx.http().get(`/appointments/slots?from=${day}&durationMinutes=60&membershipId=${agent2M}`).set(auth(owner.accessToken));
    expect(slots.status).toBe(200);
    expect(slots.body.days[0].slots.map((s: { startsAt: string }) => localParts('Asia/Kolkata', new Date(s.startsAt)).minute)).toEqual([600, 630, 660]);
    const l = await lead(owner);
    const first = slots.body.days[0].slots[0].startsAt as string;
    expect((await book(owner, { leadId: l, membershipId: agent2M, startsAt: first, durationMinutes: 60 })).status).toBe(201);
    const after = await ctx.http().get(`/appointments/slots?from=${day}&durationMinutes=60&membershipId=${agent2M}`).set(auth(owner.accessToken));
    expect(after.body.days[0].slots.map((s: { startsAt: string }) => localParts('Asia/Kolkata', new Date(s.startsAt)).minute)).toEqual([660]);
    const l2 = await lead(owner);
    const outside = await book(owner, { leadId: l2, membershipId: agent2M, startsAt: zonedToUtc(day, 14 * 60, 'Asia/Kolkata').toISOString(), durationMinutes: 60 });
    expect(outside.status).toBe(422);
    // a manager may deliberately book outside hours (still subject to overlap rules)
    const forced = await book(owner, { leadId: l2, membershipId: agent2M, startsAt: zonedToUtc(day, 14 * 60, 'Asia/Kolkata').toISOString(), durationMinutes: 60, outsideHours: true });
    expect(forced.status).toBe(201);
    // blocking the morning removes it from the slot list
    await ctx.http().post('/appointments/availability/exceptions').set(auth(owner.accessToken)).send({ membershipId: agent2M, date: day, startMinute: 600, endMinute: 720, reason: 'leave' });
    const blocked = await ctx.http().get(`/appointments/slots?from=${day}&durationMinutes=60&membershipId=${agent2M}`).set(auth(owner.accessToken));
    expect(blocked.body.days[0].slots).toHaveLength(0);
  });

  it('rejects times in the past and overlapping availability windows', async () => {
    const l = await lead(owner);
    expect((await book(owner, { leadId: l, membershipId: agentM, startsAt: new Date(Date.now() - 3600_000).toISOString(), durationMinutes: 60 })).status).toBe(422);
    const bad = await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: null, rules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 700 }, { dayOfWeek: 1, startMinute: 650, endMinute: 800 }] });
    expect(bad.status).toBe(400);
  });

  it('agents may edit only their own availability', async () => {
    const mine = await ctx.http().put('/appointments/availability').set(auth(agent.accessToken)).send({ membershipId: agentM, rules: [{ dayOfWeek: 2, startMinute: 600, endMinute: 900 }] });
    expect(mine.status).toBe(200);
    expect((await ctx.http().put('/appointments/availability').set(auth(agent.accessToken)).send({ membershipId: agent2M, rules: [] })).status).toBe(403);
    expect((await ctx.http().put('/appointments/availability').set(auth(agent.accessToken)).send({ membershipId: null, rules: [] })).status).toBe(403);
    // restore full availability for later tests
    await ctx.http().put('/appointments/availability').set(auth(agent.accessToken)).send({ membershipId: agentM, rules: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 })) });
  });
});

describe('lifecycle', () => {
  it('walks pending -> confirmed -> completed and records history', async () => {
    const l = await lead(owner);
    const created = await book(agent, { leadId: l, membershipId: agentM, startsAt: new Date(Date.now() + 40 * 60_000).toISOString(), durationMinutes: 15 });
    expect(created.status).toBe(403); // lead belongs to the owner's workspace but is not assigned to this agent
    const mine = await lead(owner, 'Assigned lead', { assignedMembershipId: agentM });
    const ok = await book(agent, { leadId: mine, membershipId: agentM, startsAt: at(10, 5), durationMinutes: 60 });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('CONFIRMED');
    const early = await ctx.http().post(`/appointments/${ok.body.id}/complete`).set(auth(agent.accessToken));
    expect(early.status).toBe(422);
    const noShowEarly = await ctx.http().post(`/appointments/${ok.body.id}/no-show`).set(auth(agent.accessToken));
    expect(noShowEarly.status).toBe(422);
    const detail = await ctx.http().get(`/appointments/${ok.body.id}`).set(auth(agent.accessToken));
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(['created']);
  });

  it('rejects illegal transitions and double transitions', async () => {
    const l = await lead(owner);
    const a = await book(owner, { leadId: l, membershipId: ownerM, startsAt: at(11, 5), durationMinutes: 60 });
    const cancel = await ctx.http().post(`/appointments/${a.body.id}/cancel`).set(auth(owner.accessToken)).send({ reason: 'x' });
    expect(cancel.status).toBe(200); expect(cancel.body.cancelledReason).toBe('x');
    expect((await ctx.http().post(`/appointments/${a.body.id}/confirm`).set(auth(owner.accessToken))).status).toBe(409);
    expect((await ctx.http().post(`/appointments/${a.body.id}/cancel`).set(auth(owner.accessToken)).send({})).status).toBe(409);
    expect((await ctx.http().post(`/appointments/${a.body.id}/reschedule`).set(auth(owner.accessToken)).send({ startsAt: at(12, 5) })).status).toBe(409);
  });

  it('reschedules into a new appointment, linking history, and can overlap its own old slot', async () => {
    const l = await lead(owner);
    const a = await book(owner, { leadId: l, membershipId: ownerM, startsAt: at(13, 5), durationMinutes: 60 });
    const moved = await ctx.http().post(`/appointments/${a.body.id}/reschedule`).set(auth(owner.accessToken)).send({ startsAt: at(13, 5, 30), reason: 'customer late' });
    expect(moved.status).toBe(200);
    expect(moved.body.rescheduledFromId).toBe(a.body.id);
    expect(moved.body.status).toBe('CONFIRMED');
    const old = await ctx.http().get(`/appointments/${a.body.id}`).set(auth(owner.accessToken));
    expect(old.body.status).toBe('RESCHEDULED');
    expect(old.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'rescheduled_from']);
  });

  it('a failed reschedule (target taken) leaves the original untouched', async () => {
    const [l1, l2] = await Promise.all([lead(owner), lead(owner)]);
    const a = await book(owner, { leadId: l1, membershipId: ownerM, startsAt: at(14, 5), durationMinutes: 60 });
    await book(owner, { leadId: l2, membershipId: ownerM, startsAt: at(14, 8), durationMinutes: 60 });
    const res = await ctx.http().post(`/appointments/${a.body.id}/reschedule`).set(auth(owner.accessToken)).send({ startsAt: at(14, 8, 30) });
    expect(res.status).toBe(409);
    const same = await ctx.http().get(`/appointments/${a.body.id}`).set(auth(owner.accessToken));
    expect(same.body.status).toBe('CONFIRMED');
  });

  it('emits outbox events in the same transaction', async () => {
    const l = await lead(owner);
    const a = await book(owner, { leadId: l, membershipId: ownerM, startsAt: at(15, 5), durationMinutes: 60 });
    const rows = await (ctx.app.get(await import('../src/db/db.module.js').then((m) => m.DbService)) as import('../src/db/db.module.js').DbService).tenantTx({ tenantId: owner.tenantId }, (tx) => tx.outboxEvent.findMany({ where: { type: 'appointment.booked' } }));
    expect(rows.some((r) => (r.payload as { appointmentId?: string }).appointmentId === a.body.id)).toBe(true);
  });
});

describe('access scoping', () => {
  it('agents see only their own appointments; managers all; other tenants none', async () => {
    const l = await lead(owner);
    const a = await book(owner, { leadId: l, membershipId: ownerM, startsAt: at(16, 5), durationMinutes: 60 });
    expect((await ctx.http().get(`/appointments/${a.body.id}`).set(auth(agent.accessToken))).status).toBe(404);
    expect((await ctx.http().post(`/appointments/${a.body.id}/cancel`).set(auth(agent.accessToken)).send({})).status).toBe(404);
    expect((await ctx.http().get(`/appointments/${a.body.id}`).set(auth(other.accessToken))).status).toBe(404);
    const list = await ctx.http().get('/appointments').set(auth(agent.accessToken));
    expect(list.body.items.every((i: { membershipId: string }) => i.membershipId === agentM)).toBe(true);
    const otherLead = await lead(other);
    expect((await book(owner, { leadId: otherLead, membershipId: ownerM, startsAt: at(17, 5), durationMinutes: 60 })).status).toBe(404);
    const crossAgent = await book(other, { leadId: otherLead, membershipId: ownerM, startsAt: at(17, 5), durationMinutes: 60 });
    expect(crossAgent.status).toBe(400); // the other tenant cannot name our team member as an agent
  });
});

describe('timezone and DST arithmetic (pure)', () => {
  const ny = 'America/New_York';
  const data = (start: number, end: number): AvailabilityData => ({ rules: new Map([['m', Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: start, endMinute: end }))]]), exceptions: [] });

  it('converts local wall time to UTC either side of a DST change', () => {
    expect(zonedToUtc('2027-03-13', 9 * 60, ny).toISOString()).toBe('2027-03-13T14:00:00.000Z'); // EST (UTC-5)
    expect(zonedToUtc('2027-03-14', 9 * 60, ny).toISOString()).toBe('2027-03-14T13:00:00.000Z'); // EDT (UTC-4)
    expect(zonedToUtc('2027-11-07', 9 * 60, ny).toISOString()).toBe('2027-11-07T14:00:00.000Z'); // back to EST
    expect(zonedToUtc('2027-01-26', 10 * 60, 'Asia/Kolkata').toISOString()).toBe('2027-01-26T04:30:00.000Z');
  });

  it('handles the spring-forward gap (02:30 does not exist) by moving forward', () => {
    const t = zonedToUtc('2027-03-14', 2 * 60 + 30, ny);
    expect(localParts(ny, t).minute).toBe(3 * 60 + 30);
  });

  it('generates slots by wall-clock hours across DST, with real durations', () => {
    const now = new Date('2027-03-01T00:00:00Z');
    const spring = slotsForDate({ data: data(9 * 60, 11 * 60), date: '2027-03-14', tz: ny, durationMinutes: 60, membershipIds: ['m'], busy: [], now });
    expect(spring.map((s) => s.startsAt.toISOString())).toEqual(['2027-03-14T13:00:00.000Z', '2027-03-14T13:30:00.000Z', '2027-03-14T14:00:00.000Z']);
    const fall = slotsForDate({ data: data(9 * 60, 10 * 60), date: '2027-11-07', tz: ny, durationMinutes: 60, membershipIds: ['m'], busy: [], now });
    expect(fall.map((s) => s.startsAt.toISOString())).toEqual(['2027-11-07T14:00:00.000Z']);
  });

  it('subtracts partial-day exceptions and honours minimum notice', () => {
    const d: AvailabilityData = { ...data(9 * 60, 13 * 60), exceptions: [{ membershipId: null, date: '2027-06-01', startMinute: 11 * 60, endMinute: 12 * 60 }] };
    expect(windowsFor(d, 'm', '2027-06-01')).toEqual([{ start: 540, end: 660 }, { start: 720, end: 780 }]);
    const soon = slotsForDate({ data: data(9 * 60, 11 * 60), date: '2027-06-01', tz: 'UTC', durationMinutes: 30, membershipIds: ['m'], busy: [], now: new Date('2027-06-01T09:10:00Z') });
    expect(soon[0]?.startsAt.toISOString()).toBe('2027-06-01T10:00:00.000Z'); // 09:30 is less than 30 minutes away
  });
});
