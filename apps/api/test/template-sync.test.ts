import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../src/common/tokens.js';
import { loadEnv } from '../src/config/env.js';
import { MockWhatsAppClient, WhatsAppApiError, type WaTemplateInfo } from '../src/whatsapp/whatsapp.client.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

const APP_SECRET = 'platform-app-secret-for-sync-tests-0123456789';
let ctx: TestCtx; let mock: MockWhatsAppClient; let owner$: pg.Pool;
let seq = 0;
const phone = () => `${(Date.now() % 1e9) * 100 + 6_000_000_000_000_00 + ++seq}`.slice(0, 15);
const waba = () => `${4_000_000 + ++seq}${RUN.replace(/\D/g, '').slice(0, 3)}`.slice(0, 12).padEnd(8, '1');
const rows = async (sql: string, p: unknown[]) => (await owner$.query(sql, p)).rows;
const tpl = (name: string, status = 'APPROVED', bodyText = 'Hi {{1}}, your visit is on {{2}}', language = 'en', category = 'UTILITY'): WaTemplateInfo => ({ name, language, category, status, bodyText });
const connect = async (acct: Account, w = waba()) => { const o = { name: 'Front desk', code: 'mock-ok-1', phoneNumberId: phone(), wabaId: w }; const r = await ctx.http().post('/channels/whatsapp/embedded').set(auth(acct.accessToken)).send(o); expect(r.status).toBe(201); return { ...o, id: r.body.id as string }; };
const list = async (acct: Account) => (await ctx.http().get('/whatsapp/templates').set(auth(acct.accessToken))).body as { name: string; language: string; source: string; approvalStatus: string | null; bodyPreview: string; variableCount: number }[];
const sync = (acct: Account) => ctx.http().post('/whatsapp/templates/sync').set(auth(acct.accessToken));

beforeAll(async () => {
  const env = { ...loadEnv(), EMBEDDED_SIGNUP_MODE: 'mock' as const, META_APP_SECRET: APP_SECRET, META_APP_ID: '1234567890', META_WEBHOOK_VERIFY_TOKEN: 'verify-token-for-sync-tests' };
  ctx = await createTestApp([{ provide: ENV, useValue: env }]);
  mock = ctx.app.get(MockWhatsAppClient); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

describe('WhatsApp template sync', () => {
  it('pulls the account\'s templates when the number is connected, with Meta\'s status, and keeps them apart from hand-typed ones', async () => {
    const acct = await registerAccount(ctx, 'tsConnect'); const w = waba();
    mock.templates.set(w, [tpl('visit_reminder'), tpl('offer_blast', 'PENDING', 'Big offer {{1}}', 'en', 'MARKETING')]);
    await connect(acct, w);
    const got = await list(acct);
    expect(got.map((t) => t.name).sort()).toEqual(['offer_blast', 'visit_reminder']);
    expect(got.find((t) => t.name === 'visit_reminder')).toMatchObject({ source: 'meta', approvalStatus: 'APPROVED', variableCount: 2, bodyPreview: 'Hi {{1}}, your visit is on {{2}}' });
    expect(got.find((t) => t.name === 'offer_blast')).toMatchObject({ approvalStatus: 'PENDING' });
  });

  it('sync adds, updates and removes synced templates, never touches hand-typed ones, and reports clashes', async () => {
    const acct = await registerAccount(ctx, 'tsSync'); const w = waba();
    mock.templates.set(w, [tpl('keep_me'), tpl('change_me', 'PENDING'), tpl('drop_me')]);
    await connect(acct, w);
    // a template the workspace typed in by hand with a name that Meta will also list
    expect((await ctx.http().post('/whatsapp/templates').set(auth(acct.accessToken)).send({ name: 'mine_only', language: 'en', category: 'UTILITY', bodyPreview: 'Typed by hand {{1}}' })).status).toBe(201);
    mock.templates.set(w, [tpl('keep_me'), tpl('change_me', 'APPROVED'), tpl('brand_new', 'APPROVED', 'No placeholders here'), tpl('mine_only', 'APPROVED', 'Meta version')]);
    const r = await sync(acct);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ added: 1, updated: 2, removed: 1, clashes: ['mine_only (en)'], total: 4, accounts: 1 });
    const got = await list(acct); const byName = Object.fromEntries(got.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(['brand_new', 'change_me', 'keep_me', 'mine_only']);
    expect(byName.change_me).toMatchObject({ approvalStatus: 'APPROVED', source: 'meta' });
    expect(byName.brand_new).toMatchObject({ variableCount: 0 });
    expect(byName.mine_only).toMatchObject({ source: 'manual', approvalStatus: null, bodyPreview: 'Typed by hand {{1}}' }); // the workspace's own wins
    expect(await rows("SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'integration.whatsapp_templates_synced'", [acct.tenantId])).toHaveLength(2); // after connecting, and now
  });

  it('is for Facebook-connected numbers, needs the integration permission, and a Meta failure changes nothing', async () => {
    const manual = await registerAccount(ctx, 'tsManual'); const o = { phoneNumberId: phone(), wabaId: waba() };
    await ctx.http().post('/channels/whatsapp').set(auth(manual.accessToken)).send({ name: 'Own app', ...o, accessToken: 'x'.repeat(30), appSecret: 'own-secret-123' });
    const none = await sync(manual); expect(none.status).toBe(400); expect(none.body.error.code).toBe('no_platform_channel');

    const acct = await registerAccount(ctx, 'tsFail'); const w = waba(); mock.templates.set(w, [tpl('stay_put')]); await connect(acct, w);
    await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', acct.email)?.token });
    const agent = await addMember(ctx, acct, 'tsAgent', 'agent'); expect((await sync(agent)).status).toBe(403);
    mock.failListTemplates = new WhatsAppApiError('Rate limit hit', true, 4);
    const fail = await sync(acct); expect(fail.status).toBe(400); expect(fail.body.error.code).toBe('template_sync_failed');
    expect((await list(acct)).map((t) => t.name)).toEqual(['stay_put']);
    expect((await ctx.http().post('/whatsapp/templates/sync')).status).toBe(401);
  });

  it('only APPROVED synced templates can be sent; a pending one is refused with a clear message, a manual one is unaffected', async () => {
    const acct = await registerAccount(ctx, 'tsSend'); const w = waba();
    mock.templates.set(w, [tpl('approved_one', 'APPROVED', 'Hello {{1}}'), tpl('pending_one', 'PENDING', 'Hello {{1}}')]);
    const c = await connect(acct, w);
    await ctx.http().post('/whatsapp/templates').set(auth(acct.accessToken)).send({ name: 'typed_one', language: 'en', category: 'UTILITY', bodyPreview: 'Hello {{1}}' });
    // a customer writes in (platform webhook), which also records their opt-in
    const from = `91981${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: c.phoneNumberId }, contacts: [{ wa_id: from, profile: { name: 'Pat' } }], messages: [{ from, id: `wamid.TS${RUN}${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hi' } }] } }] }] });
    expect((await ctx.http().post('/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`).send(raw)).body.status).toBe('ok');
    const conv = (await rows('SELECT id FROM conversations WHERE tenant_id = $1 AND channel_id = $2', [acct.tenantId, c.id]))[0].id as string;
    const send = (name: string) => ctx.http().post(`/conversations/${conv}/messages`).set(auth(acct.accessToken)).send({ template: { name, language: 'en', params: ['Pat'] } });
    expect((await send('approved_one')).status).toBe(201);
    expect((await send('typed_one')).status).toBe(201);
    const blocked = await send('pending_one'); expect(blocked.status).toBe(422); expect(blocked.body.error.code).toBe('template_not_approved'); expect(blocked.body.error.message).toContain('pending');
    // Meta approves it; the next sync makes it sendable
    mock.templates.set(w, [tpl('approved_one', 'APPROVED', 'Hello {{1}}'), tpl('pending_one', 'APPROVED', 'Hello {{1}}')]); await sync(acct);
    expect((await send('pending_one')).status).toBe(201);
  });
});
