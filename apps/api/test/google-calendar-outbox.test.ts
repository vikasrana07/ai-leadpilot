import 'reflect-metadata';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from '../src/integrations/google-calendar/google-calendar.service.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit S-10: the Google Calendar push ran inside the booking transaction with errors swallowed (`.catch(() => null)`): a slow Google
 * held a database connection, and a failure was lost for good. It is now an outbox event handled by the relay (retry with backoff), in its
 * own event type so an outage never delays the notifications and automations of the same appointment.
 */
let ctx: TestCtx; let db: pg.Pool; let owner: Account; let agentM = ''; let gcal: GoogleCalendarService; let relay: OutboxRelay; let leadId = '';
const at = (daysAhead: number, hourUtc: number) => { const d = new Date(Date.now() + daysAhead * 86_400_000); d.setUTCHours(hourUtc, 0, 0, 0); return d.toISOString(); };
const events = async (type: string) => (await db.query(`SELECT status, attempts, payload FROM outbox_events WHERE tenant_id = $1 AND type = $2 ORDER BY created_at`, [owner.tenantId, type])).rows as { status: string; attempts: number; payload: { appointmentId: string; action: string } }[];
const book = (day: number) => ctx.http().post('/appointments').set(auth(owner.accessToken)).send({ leadId, membershipId: agentM, startsAt: at(day, 10), durationMinutes: 30, title: 'Visit' });
/** Make a backed-off event due now (the relay schedules retries seconds to minutes ahead). */
const makeDue = () => db.query(`UPDATE outbox_events SET available_at = now() WHERE tenant_id = $1 AND status = 'pending'`, [owner.tenantId]);

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'gcalOutbox');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  const agent = await addMember(ctx, owner, 'gcalOutboxAgent', 'agent');
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  agentM = members.body.find((m: { user: { email: string } }) => m.user.email === agent.email).id as string;
  await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: null, rules: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 })) });
  await ctx.http().post('/integrations/google-calendar/connect').set(auth(agent.accessToken)).send({ code: 'c', state: new URL((await ctx.http().get('/integrations/google-calendar/auth-url').set(auth(agent.accessToken))).body.url).searchParams.get('state') });
  leadId = (await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Outbox Lead', phone: '9812340001' })).body.id;
  gcal = ctx.app.get(GoogleCalendarService); relay = ctx.app.get(OutboxRelay);
  await relay.drainOnce(100); // clear events from setup
});

afterAll(async () => {
  await db.query('DELETE FROM appointments WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM google_calendar_syncs WHERE tenant_id = $1', [owner.tenantId]);
  await db.query('DELETE FROM integration_credentials WHERE tenant_id = $1 AND provider = $2', [owner.tenantId, 'google_calendar']);
  await db.query('DELETE FROM outbox_events WHERE tenant_id = $1', [owner.tenantId]);
  await db.end();
  await ctx.close();
  await cleanup();
});

describe('Google Calendar push through the outbox', () => {
  it('booking records a calendar_sync event and does not call Google inside the request', async () => {
    const spy = vi.spyOn(gcal, 'syncAppointment');
    const res = await book(3);
    expect(res.status).toBe(201);
    expect(spy).not.toHaveBeenCalled(); // nothing synchronous
    const ev = (await events('appointment.calendar_sync')).at(-1)!;
    expect(ev).toMatchObject({ status: 'pending', payload: { appointmentId: res.body.id, action: 'created' } });
    await relay.drainOnce(100);
    expect(spy).toHaveBeenCalledWith(expect.anything(), owner.tenantId, res.body.id, 'created', { strict: true });
    expect((await events('appointment.calendar_sync')).at(-1)!.status).toBe('processed');
    spy.mockRestore();
  });

  it('a Google failure is retried with backoff and never blocks the booking events of the same appointment', async () => {
    let failures = 1;
    const real = gcal.syncAppointment.bind(gcal);
    const spy = vi.spyOn(gcal, 'syncAppointment').mockImplementation(async (...args) => { if (failures-- > 0) throw new Error('Google is down'); return real(...args); });
    const res = await book(4);
    await relay.drainOnce(100);
    // the sync failed and is waiting to retry...
    const sync = (await events('appointment.calendar_sync')).find((e) => e.payload.appointmentId === res.body.id)!;
    expect(sync).toMatchObject({ status: 'pending', attempts: 1 });
    // ...but the booking event (notifications, automations, webhooks) was processed normally
    const booked = (await events('appointment.booked')).find((e) => e.payload.appointmentId === res.body.id)!;
    expect(booked.status).toBe('processed');
    await makeDue();
    await relay.drainOnce(100);
    expect((await events('appointment.calendar_sync')).find((e) => e.payload.appointmentId === res.body.id)!.status).toBe('processed');
    expect((await db.query('SELECT google_event_id FROM appointments WHERE id = $1', [res.body.id])).rows[0].google_event_id).toBeTruthy();
    spy.mockRestore();
  });

  it('cancelling records a cancelled sync that removes the Google event', async () => {
    const res = await book(6);
    await relay.drainOnce(100);
    expect((await db.query('SELECT google_event_id FROM appointments WHERE id = $1', [res.body.id])).rows[0].google_event_id).toBeTruthy();
    await ctx.http().post(`/appointments/${res.body.id}/cancel`).set(auth(owner.accessToken)).send({ reason: 'changed plans' });
    await relay.drainOnce(100);
    expect((await events('appointment.calendar_sync')).filter((e) => e.payload.appointmentId === res.body.id).map((e) => e.payload.action)).toEqual(['created', 'cancelled']);
    expect((await db.query('SELECT google_event_id FROM appointments WHERE id = $1', [res.body.id])).rows[0].google_event_id).toBeNull();
  });
});
