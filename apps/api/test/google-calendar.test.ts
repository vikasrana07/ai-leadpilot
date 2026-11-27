import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';
import { DbService } from '../src/db/db.module.js';
import { OutboxRelay } from '../src/ops/outbox-relay.js';

let ctx: TestCtx;
let owner: Account;
let agent: Account;
let agentM = '';

const at = (daysAhead: number, hourUtc: number, min = 0) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  d.setUTCHours(hourUtc, min, 0, 0);
  return d.toISOString();
};

beforeAll(async () => {
  process.env.GOOGLE_CALENDAR_MODE = 'mock';
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'gcalOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'gcalAgent', 'agent');
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  agentM = members.body.find((m: { user: { email: string } }) => m.user.email === agent.email).id as string;
  const open = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 }));
  await ctx.http().put('/appointments/availability').set(auth(owner.accessToken)).send({ membershipId: null, rules: open });
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('Google Calendar integration', () => {
  it('initially reports disconnected status', async () => {
    const res = await ctx.http().get('/integrations/google-calendar').set(auth(agent.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.mode).toBe('mock');
  });

  it('generates an auth URL for OAuth connection', async () => {
    const res = await ctx.http().get('/integrations/google-calendar/auth-url').set(auth(agent.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('gcal_mock=1');
  });

  const stateFor = async (token: string) => new URL((await ctx.http().get('/integrations/google-calendar/auth-url').set(auth(token))).body.url).searchParams.get('state') as string;
  const connect = (token: string, body: object) => ctx.http().post('/integrations/google-calendar/connect').set(auth(token)).send(body);

  it('rejects a connect request with no state, a forged state, or a state issued for someone else (OAuth login-CSRF guard)', async () => {
    expect((await connect(agent.accessToken, { code: 'mock_code_test' })).status).toBe(400);
    expect((await connect(agent.accessToken, { code: 'mock_code_test', state: 'forged.value' })).status).toBe(400);
    const good = await stateFor(agent.accessToken);
    const [payload] = good.split('.');
    expect((await connect(agent.accessToken, { code: 'mock_code_test', state: `${payload}.AAAA` })).status).toBe(400); // tampered signature
    const other = await registerAccount(ctx, 'gcalother');
    const othersState = await stateFor(other.accessToken);
    const res = await connect(agent.accessToken, { code: 'mock_code_test', state: othersState }); // valid signature, wrong member
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_oauth_state');
    const status = await ctx.http().get('/integrations/google-calendar').set(auth(agent.accessToken));
    expect(status.body.connected).toBe(false);
  });

  it('connects Google Calendar using mock authorization code', async () => {
    const res = await connect(agent.accessToken, { code: 'mock_code_test', state: await stateFor(agent.accessToken) });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.email).toContain('@example.com');

    // Status now reports connected
    const status = await ctx.http().get('/integrations/google-calendar').set(auth(agent.accessToken));
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(true);
    expect(status.body.email).toBe(res.body.email);
  });

  it('automatically sets googleEventId when an appointment is booked for this agent', async () => {
    const leadRes = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Google Cal Lead', phone: '9812345678' });

    const bookRes = await ctx
      .http()
      .post('/appointments')
      .set(auth(owner.accessToken))
      .send({
        leadId: leadRes.body.id,
        membershipId: agentM,
        startsAt: at(5, 10),
        durationMinutes: 45,
        title: 'Project Site Visit',
      });

    expect(bookRes.status).toBe(201);
    const aptId = bookRes.body.id;

    // Booking does not wait for Google: the push is an outbox event handled by the worker/relay.
    const db = ctx.app.get(DbService);
    expect((await db.tenantTx(owner, (tx) => tx.appointment.findUnique({ where: { id: aptId } })))?.googleEventId).toBeNull();
    await ctx.app.get(OutboxRelay).drainOnce();
    const dbApt = await db.tenantTx(owner, (tx) => tx.appointment.findUnique({ where: { id: aptId } }));
    expect(dbApt?.googleEventId).toBeTruthy();
    expect(dbApt?.googleEventId).toContain('gcal_event_');

    // Cancelling appointment removes googleEventId
    const cancelRes = await ctx
      .http()
      .post(`/appointments/${aptId}/cancel`)
      .set(auth(owner.accessToken))
      .send({ reason: 'Client requested reschedule' });

    expect(cancelRes.status).toBe(200);
    await ctx.app.get(OutboxRelay).drainOnce();
    const dbCancelled = await db.tenantTx(owner, (tx) => tx.appointment.findUnique({ where: { id: aptId } }));
    expect(dbCancelled?.googleEventId).toBeNull();
  });

  it('disconnects Google Calendar and cleans up credential', async () => {
    const delRes = await ctx.http().delete('/integrations/google-calendar').set(auth(agent.accessToken));
    expect(delRes.status).toBe(200);

    const status = await ctx.http().get('/integrations/google-calendar').set(auth(agent.accessToken));
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(false);
  });
});
