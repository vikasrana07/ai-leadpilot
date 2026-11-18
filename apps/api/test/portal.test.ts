import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockWhatsAppClient } from '../src/whatsapp/whatsapp.client.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, WEB_ORIGIN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx; let owner$: pg.Pool; let a: Account; let b: Account; let aMember = '';
let seq = 0; let apptDay = 0;
const digits = () => `98${String(10_000_000 + (++seq) * 7919 + Math.floor(Math.random() * 1000)).padStart(8, '0')}`.slice(0, 10);
const email = (tag: string) => `portal-${RUN}-${tag}-${++seq}@example.test`;
const rows = async (sql: string, p: unknown[]) => (await owner$.query(sql, p)).rows;
const lead = async (t: Account, o: Record<string, unknown> = {}) => (await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name: 'Riya Sharma', phone: digits(), email: email('lead'), ...o })).body as { id: string; email: string | null; phone: string | null };
const at = (daysAhead: number, hourUtc = 9) => { const d = new Date(Date.now() + daysAhead * 86_400_000); d.setUTCHours(hourUtc, 0, 0, 0); return d.toISOString(); };
const book = async (t: Account, leadId: string, o: Record<string, unknown> = {}) => { const r = await ctx.http().post('/appointments').set(auth(t.accessToken)).send({ leadId, membershipId: aMember, startsAt: at(20 + ++apptDay, 9), durationMinutes: 30, ...o }); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body as { id: string }; };
const config = (t: Account, body: Record<string, unknown> = {}) => ctx.http().put('/portal-config').set(auth(t.accessToken)).send({ enabled: true, ...body });
const keyOf = (url: string) => url.split('/p/')[1] as string;
const requestCode = (key: string, identity: string) => ctx.http().post(`/portal/${key}/code`).send({ identity });
const verify = (key: string, identity: string, code: string) => ctx.http().post(`/portal/${key}/verify`).send({ identity, code });
const cookieOf = (r: { headers: Record<string, unknown> }) => ((r.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('lp_portal='));
const withCookie = (path: string, cookie: string) => ctx.http().get(path).set('Cookie', cookie.split(';')[0] as string);
/** Full sign-in: request a code by email, read it from the (fake) mailbox, verify. Returns the Cookie header value. */
async function signIn(key: string, identity: string, mailbox: string): Promise<string> {
  expect((await requestCode(key, identity)).status).toBe(202);
  const code = ctx.mail.last('portal_code', mailbox)?.token; expect(code, 'no code mail').toMatch(/^\d{6}$/);
  const v = await verify(key, identity, code as string); expect(v.status, JSON.stringify(v.body)).toBe(200);
  return (cookieOf(v) as string).split(';')[0] as string;
}
let keyA = ''; let keyB = '';

beforeAll(async () => {
  ctx = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  a = await registerAccount(ctx, 'ptA'); b = await registerAccount(ctx, 'ptB');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', a.email)?.token });
  const members = await ctx.http().get('/team/members').set(auth(a.accessToken));
  aMember = members.body.find((m: { user: { email: string } }) => m.user.email === a.email).id;
  const open = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 }));
  expect((await ctx.http().put('/appointments/availability').set(auth(a.accessToken)).send({ membershipId: null, rules: open })).status).toBe(200);
  keyA = keyOf((await config(a)).body.url); keyB = keyOf((await config(b)).body.url);
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('portal settings (staff)', () => {
  it('starts unconfigured, then creates an unguessable address, and only people who manage settings can change it', async () => {
    const fresh = await registerAccount(ctx, 'ptFresh');
    const before = await ctx.http().get('/portal-config').set(auth(fresh.accessToken));
    expect(before.body).toMatchObject({ available: true, configured: false, enabled: false, url: null, allowConfirm: true, allowCancel: true, allowReschedule: true, cancelCutoffHours: 4 });
    const r = await config(fresh, { cancelCutoffHours: 12, allowReschedule: false });
    expect(r.status).toBe(200); expect(r.body.url).toBe(`${WEB_ORIGIN}/p/${keyOf(r.body.url)}`); expect(keyOf(r.body.url)).toMatch(/^pp_[A-Za-z0-9_-]{20,}$/);
    expect(r.body).toMatchObject({ configured: true, enabled: true, cancelCutoffHours: 12, allowReschedule: false });
    expect((await ctx.http().put('/portal-config').set(auth(fresh.accessToken)).send({ enabled: true, cancelCutoffHours: 999 })).status).toBe(400);
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', fresh.email)?.token });
    const agent = await addMember(ctx, fresh, 'ptAgent', 'agent');
    expect((await ctx.http().get('/portal-config').set(auth(agent.accessToken))).status).toBe(403);
    expect((await config(agent)).status).toBe(403);
    expect((await ctx.http().get('/portal-config')).status).toBe(401);
  });

  it('is a plan feature: without it staff cannot set it up and the public page is simply not there', async () => {
    try {
      await owner$.query("UPDATE plan_entitlements SET enabled = false WHERE plan_key = 'internal' AND key = 'lead_portal'");
      expect((await ctx.http().get('/portal-config').set(auth(a.accessToken))).body.available).toBe(false);
      const put = await config(a); expect(put.status).toBe(402); expect(put.body.error.code).toBe('feature_not_in_plan');
      expect((await ctx.http().get(`/portal/${keyA}`)).status).toBe(404);
      expect((await requestCode(keyA, 'x@example.test')).status).toBe(404);
    } finally { await owner$.query("UPDATE plan_entitlements SET enabled = true WHERE plan_key = 'internal' AND key = 'lead_portal'"); }
    expect((await ctx.http().get(`/portal/${keyA}`)).status).toBe(200);
  });
});

describe('sign-in page and one-time code', () => {
  it('the page names the business only; an unknown, malformed or switched-off address all say "not available"', async () => {
    const r = await ctx.http().get(`/portal/${keyA}`); expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['businessName', 'logoUrl']); expect(r.body.businessName).toMatch(/^Biz ptA /);
    expect(r.headers['cache-control']).toBe('no-store'); expect(r.headers['x-robots-tag']).toContain('noindex');
    const off = await registerAccount(ctx, 'ptOff'); const k = keyOf((await config(off, { enabled: false })).body.url);
    for (const bad of [k, 'pp_doesnotexistdoesnotexist', 'nope', 'pp_short']) { const x = await ctx.http().get(`/portal/${bad}`); expect(x.status, bad).toBe(404); expect(x.body.error.message).toBe('This page is not available'); }
  });

  it('answers identically for a known and an unknown identity, and sends a code only to the email on file', async () => {
    const l = await lead(a); const knownMail = l.email as string;
    const known = await requestCode(keyA, knownMail); const unknown = await requestCode(keyA, email('nobody'));
    expect(known.status).toBe(202); expect(unknown.status).toBe(202); expect(known.body).toEqual(unknown.body);
    const mail = ctx.mail.last('portal_code', knownMail); expect(mail?.token).toMatch(/^\d{6}$/);
    expect(ctx.mail.sent.filter((m) => m.kind === 'portal_code' && m.to.includes('nobody'))).toHaveLength(0);
    // typing the PHONE sends the code to the email on file, not to anything typed
    const l2 = await lead(a); const before = ctx.mail.sent.length;
    expect((await requestCode(keyA, l2.phone as string)).status).toBe(202);
    expect(ctx.mail.sent.slice(before).filter((m) => m.kind === 'portal_code').map((m) => m.to)).toEqual([l2.email]);
    // a lead with no email and no WhatsApp route gets nothing, with the same answer
    const l3 = await lead(a, { email: null }); const n = ctx.mail.sent.length;
    const none = await requestCode(keyA, l3.phone as string); expect(none.status).toBe(202); expect(none.body).toEqual(known.body); expect(ctx.mail.sent.length).toBe(n);
    // a badly formed identity is a plain validation error (it reveals nothing)
    expect((await requestCode(keyA, 'not a phone or email')).status).toBe(400);
    expect((await requestCode(keyA, 'ab')).status).toBe(400);
  });

  it('the code mail has no link, and the stored code is only a hash', async () => {
    const l = await lead(a); await requestCode(keyA, l.email as string);
    const code = ctx.mail.last('portal_code', l.email as string)?.token as string;
    const stored = await rows("SELECT code_hash, identity_hash, channel, attempts, expires_at > now() AS live FROM portal_login_codes WHERE lead_id = $1", [l.id]);
    expect(stored).toHaveLength(1); expect(JSON.stringify(stored[0])).not.toContain(code); expect(stored[0].identity_hash).not.toContain((l.email as string).split('@')[0]);
    expect(stored[0]).toMatchObject({ channel: 'email', attempts: 0, live: true });
  });

  it('limits codes per identity, and keeps answering the same', async () => {
    const l = await lead(a); const mails = () => ctx.mail.sent.filter((m) => m.kind === 'portal_code' && m.to === l.email).length;
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await requestCode(keyA, l.email as string));
    expect(new Set(answers.map((r) => r.status)).size).toBe(1); expect(new Set(answers.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(mails()).toBe(3);
  });

  it('verify: wrong, reused, expired, cross-workspace and unknown all fail the same way; success sets a locked-down cookie', async () => {
    const l = await lead(a); await requestCode(keyA, l.email as string); const code = ctx.mail.last('portal_code', l.email as string)?.token as string;
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await verify(keyA, l.email as string, wrong); const unknown = await verify(keyA, email('ghost'), '123456');
    expect(bad.status).toBe(401); expect(unknown.status).toBe(401); expect({ ...bad.body.error, requestId: 0 }).toEqual({ ...unknown.body.error, requestId: 0 }); expect(bad.body.error.code).toBe('invalid_code'); expect(cookieOf(bad)).toBeUndefined();
    expect((await verify(keyB, l.email as string, code)).status).toBe(401);                      // another workspace's address
    expect((await verify(keyA, l.email as string, '12345')).status).toBe(400);                  // not 6 digits
    const ok = await verify(keyA, l.email as string, code); expect(ok.status).toBe(200); expect(ok.body).toEqual({ ok: true });
    const cookie = cookieOf(ok) as string; expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i); expect(cookie).toMatch(/Path=\//); expect(cookie).toMatch(/Max-Age=3600/);
    expect((await verify(keyA, l.email as string, code)).status).toBe(401);                      // single use
    // expiry
    const l2 = await lead(a); await requestCode(keyA, l2.email as string); const c2 = ctx.mail.last('portal_code', l2.email as string)?.token as string;
    await owner$.query("UPDATE portal_login_codes SET expires_at = now() - interval '1 minute' WHERE lead_id = $1", [l2.id]);
    expect((await verify(keyA, l2.email as string, c2)).status).toBe(401);
  });

  it('a code dies after 5 wrong tries, even if the right one is then entered', async () => {
    const l = await lead(a); await requestCode(keyA, l.email as string); const code = ctx.mail.last('portal_code', l.email as string)?.token as string;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await verify(keyA, l.email as string, wrong)).status).toBe(401);
    expect((await rows('SELECT attempts FROM portal_login_codes WHERE lead_id = $1', [l.id]))[0].attempts).toBe(5);
    expect((await verify(keyA, l.email as string, code)).status).toBe(401);
  });

  it('works for a phone typed in a different format than the one on file', async () => {
    const l = await lead(a); const n = (l.phone as string).replace(/\D/g, '').slice(-10);
    const cookie = await signIn(keyA, `+91 ${n.slice(0, 5)} ${n.slice(5)}`, l.email as string);
    expect((await withCookie('/portal/me', cookie)).status).toBe(200);
  });
});

describe('session and what the customer sees', () => {
  it('me: business and first name only; no cookie, a tampered cookie and other kinds of token are refused, and a portal token works nowhere else', async () => {
    const l = await lead(a, { name: 'Riya Sharma' }); const cookie = await signIn(keyA, l.email as string, l.email as string);
    const me = await withCookie('/portal/me', cookie); expect(me.status).toBe(200);
    expect(Object.keys(me.body).sort()).toEqual(['allow', 'appointmentNoun', 'appointmentNounPlural', 'businessName', 'cancelCutoffHours', 'firstName', 'logoUrl', 'timezone']);
    expect(me.body).toMatchObject({ firstName: 'Riya', allow: { confirm: true, cancel: true, reschedule: true }, cancelCutoffHours: 4 }); expect(me.headers['cache-control']).toBe('no-store');
    expect((await ctx.http().get('/portal/me')).status).toBe(401);
    expect((await ctx.http().get('/portal/me').set('Cookie', cookie.slice(0, -6) + 'AAAAAA')).status).toBe(401);
    expect((await ctx.http().get('/portal/me').set('Cookie', 'lp_portal=' + a.accessToken)).status).toBe(401);       // a staff token is not a portal session
    expect((await ctx.http().get('/portal/me').set(auth(a.accessToken))).status).toBe(401);                          // and a bearer token is not read as one
    const token = cookie.split('=')[1] as string;
    expect((await ctx.http().get('/auth/me').set(auth(token))).status).toBe(401);                                    // a portal token is not a staff token
    expect((await ctx.http().get('/leads').set('Cookie', `lp_at=${token}`)).status).toBe(401);
    expect((await ctx.http().get('/portal-config').set(auth(token))).status).toBe(401);
  });

  it('appointments: a customer-safe shape, the customer\'s own only, even inside one workspace and across workspaces', async () => {
    const mine = await lead(a, { name: 'Mina Patel' }); const other = await lead(a, { name: 'Other Person' });
    const b1 = await lead(b, { email: mine.email, phone: mine.phone, name: 'Same Contact In B' }); // same email/phone, different business
    const a1 = await book(a, mine.id, { title: 'Site visit', location: 'Tower 2, Andheri', notes: 'INTERNAL: budget low, push hard' });
    await book(a, other.id, { title: 'Someone else\'s visit' });
    await ctx.http().post('/appointments').set(auth(b.accessToken)).send({ leadId: b1.id, membershipId: (await ctx.http().get('/team/members').set(auth(b.accessToken))).body[0].id, startsAt: at(6, 8), durationMinutes: 30 });
    const cookie = await signIn(keyA, mine.email as string, mine.email as string);
    const r = await withCookie('/portal/appointments', cookie); expect(r.status).toBe(200);
    expect(r.body.upcoming).toHaveLength(1); expect(r.body.past).toHaveLength(0);
    const item = r.body.upcoming[0];
    expect(item.id).toBe(a1.id); expect(Object.keys(item).sort()).toEqual(['agentFirstName', 'canCancel', 'canConfirm', 'canReschedule', 'endsAt', 'id', 'location', 'startsAt', 'status', 'title']);
    expect(item).toMatchObject({ title: 'Site visit', location: 'Tower 2, Andheri', status: 'CONFIRMED', canConfirm: false, canCancel: true, canReschedule: true }); // staff bookings start confirmed
    const text = JSON.stringify(r.body); for (const secret of ['INTERNAL', 'budget', a.email, aMember, 'Other Person', 'Someone else']) expect(text, secret).not.toContain(secret);
    expect(item.agentFirstName).toBe('User'); // first name only ("User ptA")
  });

  it('cancel rules show up as flags: inside the cutoff, past, cancelled and settings that switch actions off', async () => {
    const l = await lead(a); const soon = await book(a, l.id, { startsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }); const later = await book(a, l.id, { startsAt: at(9, 10) });
    await owner$.query("UPDATE appointments SET status = 'PENDING' WHERE id = ANY($1::uuid[])", [[soon.id, later.id]]);
    const cookie = await signIn(keyA, l.email as string, l.email as string);
    const get = async () => (await withCookie('/portal/appointments', cookie)).body.upcoming as { id: string; canConfirm: boolean; canCancel: boolean; canReschedule: boolean }[];
    let up = await get(); const s = up.find((x) => x.id === soon.id)!; const g = up.find((x) => x.id === later.id)!;
    expect(s).toMatchObject({ canConfirm: true, canCancel: false, canReschedule: false });   // inside the 4-hour cutoff
    expect(g).toMatchObject({ canConfirm: true, canCancel: true, canReschedule: true });
    await config(a, { allowCancel: false, allowConfirm: false, allowReschedule: true });
    up = await get(); expect(up.find((x) => x.id === later.id)).toMatchObject({ canConfirm: false, canCancel: false, canReschedule: true });
    await owner$.query("UPDATE appointments SET status = 'CANCELLED' WHERE id = $1", [later.id]);
    const r = await withCookie('/portal/appointments', cookie); expect(r.body.upcoming.some((x: { id: string }) => x.id === later.id)).toBe(false); expect(r.body.past.some((x: { id: string }) => x.id === later.id)).toBe(true);
    await config(a); // restore defaults for later tests
  });

  it('a lead merged into another shows the appointments of both; an erased or deleted lead has no session', async () => {
    const primary = await lead(a, { name: 'Primary' }); const dupe = await lead(a, { name: 'Duplicate' });
    await book(a, primary.id, { title: 'First' }); await book(a, dupe.id, { title: 'Second' });
    await owner$.query('UPDATE leads SET merged_into_id = $1 WHERE id = $2', [primary.id, dupe.id]);
    const cookie = await signIn(keyA, primary.email as string, primary.email as string);
    expect((await withCookie('/portal/appointments', cookie)).body.upcoming.map((x: { title: string }) => x.title).sort()).toEqual(['First', 'Second']);
    await owner$.query('UPDATE leads SET deleted_at = now() WHERE id = $1', [primary.id]);
    expect((await withCookie('/portal/me', cookie)).status).toBe(401);
    expect((await requestCode(keyA, primary.email as string)).status).toBe(202); // still the same answer; no new code exists for a deleted lead
    expect((await rows('SELECT 1 FROM portal_login_codes WHERE lead_id = $1 AND consumed_at IS NULL', [primary.id])).length).toBe(0);
  });
});

describe('ending sessions', () => {
  it('logout, switching the portal off, rotating the address and the lead being deleted all end the session at once', async () => {
    const mk = async () => { const l = await lead(a); return { l, cookie: await signIn(keyA, l.email as string, l.email as string) }; };
    const out = await mk();
    expect((await ctx.http().post('/portal/logout').set('Cookie', out.cookie).set('Origin', WEB_ORIGIN)).status).toBe(204);
    expect((await withCookie('/portal/me', out.cookie)).status).toBe(401);
    expect([401, 403]).toContain((await ctx.http().post('/portal/logout').set('Cookie', out.cookie)).status); // no session that works, no Origin: refused either way

    const off = await mk(); await config(a, { enabled: false });
    expect((await withCookie('/portal/me', off.cookie)).status).toBe(401); expect((await ctx.http().get(`/portal/${keyA}`)).status).toBe(404);
    await config(a); const back = await mk(); expect((await withCookie('/portal/me', back.cookie)).status).toBe(200);

    const rot = await ctx.http().post('/portal-config/rotate-key').set(auth(a.accessToken)); expect(rot.status).toBe(200);
    const newKey = keyOf(rot.body.url); expect(newKey).not.toBe(keyA);
    expect((await withCookie('/portal/me', back.cookie)).status).toBe(401);
    expect((await ctx.http().get(`/portal/${keyA}`)).status).toBe(404); expect((await ctx.http().get(`/portal/${newKey}`)).status).toBe(200);
    keyA = newKey;
    expect((await ctx.http().post('/portal-config/rotate-key').set(auth((await registerAccount(ctx, 'ptNoCfg')).accessToken))).status).toBe(409);
  });

  it('every portal change is audited without personal data', async () => {
    const acts = (await rows("SELECT action, metadata FROM audit_logs WHERE tenant_id = $1 AND action LIKE 'portal.%'", [a.tenantId])).map((r) => r.action as string);
    for (const x of ['portal.config_updated', 'portal.key_rotated', 'portal.signed_in']) expect(acts).toContain(x);
    expect(JSON.stringify(await rows("SELECT metadata FROM audit_logs WHERE tenant_id = $1 AND action = 'portal.signed_in'", [a.tenantId]))).not.toContain('@example.test');
  });
});

describe('WhatsApp codes', () => {
  it('go out only with an active channel, a conversation, an opt-in and an approved template, and the code is scrubbed from the stored message', async () => {
    const mock = ctx.app.get(MockWhatsAppClient); const owner = await registerAccount(ctx, 'ptWa');
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
    const key = keyOf((await config(owner)).body.url);
    const phoneId = `75${String(Date.now()).slice(-12)}`; const secret = 'portal-wa-secret-123456';
    const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ name: 'Line', phoneNumberId: phoneId, wabaId: `76${phoneId.slice(2)}`, accessToken: 'EAAGportalToken1234567890123', appSecret: secret });
    expect(ch.status).toBe(201); const hook = new URL(ch.body.webhookUrl).pathname;
    const l = await lead(owner, { email: null }); const from = (l.phone as string).replace(/\D/g, '');
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: from, profile: { name: 'Riya' } }], messages: [{ from, id: `wamid.PW${RUN}${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hello' } }] } }] }] });
    expect((await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`).send(raw)).body.status).toBe('ok');
    const phone = l.phone as string; const before = () => mock.sent.filter((s) => s.kind === 'template' && s.template?.name === 'portal_login_code').length;

    // no template registered: no message, same answer
    expect((await requestCode(key, phone)).status).toBe(202); await new Promise((r) => setTimeout(r, 300)); expect(before()).toBe(0);
    // register the template and it goes out, with the code as the only value
    expect((await ctx.http().post('/whatsapp/templates').set(auth(owner.accessToken)).send({ name: 'portal_login_code', language: 'en', category: 'AUTHENTICATION', bodyPreview: 'Your code is {{1}}' })).status).toBe(201);
    const second = await lead(owner, { email: null }); // a second lead, to avoid the per-identity limit
    expect((await requestCode(key, phone)).status).toBe(202);
    for (let t = 0; t < 30 && before() === 0; t++) await new Promise((r) => setTimeout(r, 100));
    expect(before()).toBe(1); const sent = mock.sent.filter((s) => s.template?.name === 'portal_login_code').at(-1)!; expect(sent.template?.params).toHaveLength(1); expect(sent.template?.params[0]).toMatch(/^\d{6}$/);
    const code = sent.template?.params[0] as string;
    await new Promise((r) => setTimeout(r, 300));
    const stored = await rows("SELECT template FROM messages WHERE tenant_id = $1 AND type = 'TEMPLATE'", [owner.tenantId]);
    expect(JSON.stringify(stored)).not.toContain(code); expect(JSON.stringify(stored)).toContain('******');
    const v = await verify(key, phone, code); expect(v.status).toBe(200);
    // an opt-out stops it
    await owner$.query("INSERT INTO consents (tenant_id, lead_id, channel, status, source) VALUES ($1, $2, 'whatsapp', 'OPTED_OUT', 'test')", [owner.tenantId, l.id]);
    const n = before(); await requestCode(key, phone); await new Promise((r) => setTimeout(r, 400)); expect(before()).toBe(n);
    expect(second.id).toBeTruthy();
  });
});

describe('find_portal_by_public_key()', () => {
  it('returns only what a sign-in page needs and is not callable by PUBLIC', async () => {
    const r = (await rows('SELECT * FROM find_portal_by_public_key($1)', [keyB]))[0];
    expect(Object.keys(r).sort()).toEqual(['allow_cancel', 'allow_confirm', 'allow_reschedule', 'business_name', 'cancel_cutoff_hours', 'enabled', 'logo_url', 'tenant_id', 'timezone']);
    expect(await rows("SELECT * FROM find_portal_by_public_key('pp_nothing')", [])).toHaveLength(0);
    expect((await rows("SELECT has_function_privilege('public', 'find_portal_by_public_key(text)', 'EXECUTE') AS pub, has_function_privilege('leadpilot_app', 'find_portal_by_public_key(text)', 'EXECUTE') AS app", []))[0]).toEqual({ pub: false, app: true });
  });
});
