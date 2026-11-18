import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../src/ops/outbox-relay.js';
import { RealtimeService } from '../src/realtime/realtime.module.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, WEB_ORIGIN, type Account, type TestCtx } from './helpers.js';

/** A customer writing in (website chat or WhatsApp) must reach the team: a notification for the owner of the chat, or the managers when nobody owns it. */
let ctx: TestCtx; let owner$: pg.Pool; let owner: Account; let agent: Account; let agentM = ''; let pk = '';
let seq = 0;
const rows = async (sql: string, p: unknown[]) => (await owner$.query(sql, p)).rows;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const drain = async () => { for (let i = 0; i < 6; i++) { await ctx.app.get(OutboxRelay).drainOnce(200); await sleep(60); } };
const notes = async (t: Account) => ((await ctx.http().get('/notifications?limit=50').set(auth(t.accessToken))).body.items as { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean }[]).filter((n) => n.type === 'new_message');

/** A new visitor starts a chat; returns what is needed to keep writing. */
async function visitor(name: string) {
  const s = await ctx.http().post('/widget/sessions').set('Origin', WEB_ORIGIN).send({ key: pk, name, phone: `98${String(20_000_000 + (++seq) * 7919 + Math.floor(Math.random() * 900)).slice(0, 8)}` });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  const convo = (await rows("SELECT c.id FROM conversations c JOIN leads l ON l.id = c.lead_id WHERE c.tenant_id = $1 AND l.name = $2 ORDER BY c.created_at DESC LIMIT 1", [owner.tenantId, name]))[0].id as string;
  const say = async (text: string) => { const r = await ctx.http().post('/widget/messages').set('Origin', WEB_ORIGIN).set('authorization', `Bearer ${s.body.token}`).send({ text }); expect(r.status, JSON.stringify(r.body)).toBe(201); await drain(); };
  return { convo, say };
}

beforeAll(async () => {
  ctx = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'nmOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'nmAgent', 'agent');
  agentM = (await ctx.http().get('/team/members').set(auth(owner.accessToken))).body.find((m: { user: { email: string } }) => m.user.email === agent.email).id;
  pk = (await ctx.http().put('/widget-config').set(auth(owner.accessToken)).send({ allowedOrigins: [WEB_ORIGIN], color: '#3f55e8', position: 'right', title: 'Chat', greeting: 'Hi' })).body.publicKey;
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('new customer message notifications', () => {
  it('a new chat notifies the owner/managers with the customer, a preview and a working link; an unassigned chat does not notify agents', async () => {
    const v = await visitor('Nm Visitor One'); await v.say('Do you have a 2BHK in Baner?');
    const n = (await notes(owner)).filter((x) => x.title.includes('Nm Visitor One'));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ title: 'New chat from Nm Visitor One', body: 'Do you have a 2BHK in Baner?', link: `/inbox?c=${v.convo}`, read: false });
    expect((await notes(agent)).filter((x) => x.title.includes('Nm Visitor One'))).toHaveLength(0);
  });

  it('collapses a burst into one notice, notifies again after it is read, and again after a quiet minute even if it was never read', async () => {
    const v = await visitor('Nm Visitor Two'); await v.say('Hello'); await v.say('Anyone there?'); await v.say('Please reply');
    const mine = async () => (await notes(owner)).filter((x) => x.title.includes('Nm Visitor Two'));
    expect(await mine()).toHaveLength(1);
    expect((await ctx.http().post(`/notifications/${(await mine())[0]!.id}/read`).set(auth(owner.accessToken))).status).toBeLessThan(300);
    await v.say('Still waiting');
    const after = await mine(); expect(after).toHaveLength(2); expect(after.map((x) => x.title).sort()).toEqual(['New chat from Nm Visitor Two', 'New message from Nm Visitor Two']);
    // the newest one is still unread: a burst right after it stays collapsed, but once it is more than a minute old the next message is announced
    await v.say('One more');
    expect(await mine()).toHaveLength(2);
    await owner$.query("UPDATE notifications SET created_at = now() - interval '2 minutes' WHERE tenant_id = $1 AND type = 'new_message' AND title LIKE '%Nm Visitor Two' AND read_at IS NULL", [owner.tenantId]);
    await v.say('Are you there?');
    expect(await mine()).toHaveLength(3);
  });

  it('goes to the assigned team member only', async () => {
    const v = await visitor('Nm Visitor Three');
    expect((await ctx.http().post(`/conversations/${v.convo}/assign`).set(auth(owner.accessToken)).send({ assignedMembershipId: agentM })).status).toBe(204);
    await v.say('Is the flat still available?');
    expect((await notes(agent)).filter((x) => x.title.includes('Nm Visitor Three'))).toHaveLength(1);
    expect((await notes(owner)).filter((x) => x.title.includes('Nm Visitor Three'))).toHaveLength(0);
  });

  it('when the AI is handling the chat, only the first message interrupts a person', async () => {
    const v = await visitor('Nm Visitor Four');
    await owner$.query("UPDATE conversations SET mode = 'AI' WHERE id = $1", [v.convo]);
    await v.say('First question'); await v.say('Second question');
    const first = (await notes(owner)).filter((x) => x.title.includes('Nm Visitor Four')); expect(first).toHaveLength(1);
    await ctx.http().post(`/notifications/${first[0]!.id}/read`).set(auth(owner.accessToken));
    await v.say('Third question'); await v.say('Fourth question');
    expect((await notes(owner)).filter((x) => x.title.includes('Nm Visitor Four'))).toHaveLength(1); // the AI is on it: no more interruptions
    await owner$.query("UPDATE conversations SET mode = 'HUMAN' WHERE id = $1", [v.convo]);          // a person joined: now every unread message counts
    await v.say('Fifth question');
    expect((await notes(owner)).filter((x) => x.title.includes('Nm Visitor Four'))).toHaveLength(2);
  });

  it('respects a person\'s choice to mute this kind of notification', async () => {
    expect((await ctx.http().put('/notifications/preferences').set(auth(agent.accessToken)).send({ preferences: [{ type: 'new_message', inApp: false }] })).status).toBeLessThan(300);
    const v = await visitor('Nm Visitor Five');
    await ctx.http().post(`/conversations/${v.convo}/assign`).set(auth(owner.accessToken)).send({ assignedMembershipId: agentM });
    await v.say('Hello?');
    expect((await notes(agent)).filter((x) => x.title.includes('Nm Visitor Five'))).toHaveLength(0);
  });

  it('is pushed live with the title, preview and link, so the page can pop it up', async () => {
    const live: { type?: string; title?: string; body?: string | null; link?: string | null }[] = [];
    const unsub = ctx.app.get(RealtimeService).subscribe(owner.tenantId, (e) => { if (e.type === 'notification.created') live.push((e.data ?? {}) as never); });
    try {
      const v = await visitor('Nm Visitor Six'); await v.say('Live check');
      const hit = live.find((x) => x.title === 'New chat from Nm Visitor Six');
      expect(hit).toMatchObject({ type: 'new_message', body: 'Live check', link: `/inbox?c=${v.convo}` });
    } finally { unsub(); }
    expect(RUN).toBeTruthy();
  });
});
