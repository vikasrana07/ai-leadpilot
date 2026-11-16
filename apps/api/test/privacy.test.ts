import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

/** DPDP data-principal rights: export and irreversible erasure of everything about one lead, tenant-scoped and audited without content. */
let ctx: TestCtx; let owner$: pg.Pool; let t: Account; let other: Account;
const SECRET = 'privacy-secret-123456'; const PHONE_ID = `77${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
let hook = '';
const q = (sql: string, p: unknown[] = []) => owner$.query(sql, p);
const count = async (table: string, col: string, ids: string[]) => ((await q(`SELECT count(*)::int n FROM ${table} WHERE ${col} = ANY($1::uuid[])`, [ids])).rows[0].n as number);

beforeAll(async () => {
  ctx = await createTestApp(); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  t = await registerAccount(ctx, 'prvOwner'); other = await registerAccount(ctx, 'prvOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(t.accessToken)).send({ name: 'Prv line', phoneNumberId: PHONE_ID, wabaId: `78${PHONE_ID.slice(2)}`, accessToken: 'EAAGprvToken1234567890123456', appSecret: SECRET });
  hook = new URL(ch.body.webhookUrl).pathname;
});
afterAll(async () => { await owner$.end(); await ctx.close(); await cleanup(); });

async function customer(phone: string) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: phone, profile: { name: 'Erase Me' } }], messages: [{ from: phone, id: `wamid.PRV${RUN}${phone}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'my private message' } }] } }] }] });
  await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`).send(body);
  const c = (await ctx.http().get(`/conversations?q=${phone.slice(2)}&pageSize=5`).set(auth(t.accessToken))).body.items[0] as { id: string; lead: { id: string } };
  return { conversationId: c.id, leadId: c.lead.id };
}

describe('lead erasure and export', () => {
  it('exports everything held about a lead, and erases it irreversibly across every table, leaving only a content-free audit entry', async () => {
    const phone = `91960${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const { leadId, conversationId } = await customer(phone);
    await ctx.http().post(`/leads/${leadId}/notes`).set(auth(t.accessToken)).send({ body: 'called, interested in 3BHK' });
    await ctx.http().post(`/tasks`).set(auth(t.accessToken)).send({ title: 'Call back', leadId, dueAt: new Date(Date.now() + 86_400_000).toISOString() });
    await q(`INSERT INTO consents (id, tenant_id, lead_id, channel, status, source) VALUES (gen_random_uuid(), $1, $2, 'whatsapp', 'OPTED_IN', 'test')`, [t.tenantId, leadId]);
    const keep = await customer(`91961${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`); // an unrelated person in the same workspace

    const exp = await ctx.http().get(`/privacy/leads/${leadId}/export`).set(auth(t.accessToken));
    expect(exp.status).toBe(200);
    expect(JSON.stringify(exp.body)).toContain('my private message'); expect(JSON.stringify(exp.body.notes)).toContain('interested in 3BHK'); expect(exp.body.consents.length).toBeGreaterThanOrEqual(1);
    expect((await q(`SELECT count(*)::int n FROM webhook_events WHERE tenant_id = $1 AND payload::text LIKE $2`, [t.tenantId, `%${phone}%`])).rows[0].n).toBeGreaterThan(0);

    // safety rails: confirmation, reason, role
    expect((await ctx.http().post(`/privacy/leads/${leadId}/erase`).set(auth(t.accessToken)).send({ reason: 'DSR-1' })).status).toBe(400);
    expect((await ctx.http().post(`/privacy/leads/${leadId}/erase`).set(auth(t.accessToken)).send({ reason: 'x', confirm: 'ERASE' })).status).toBe(400);
    const manager = await addMember(ctx, t, 'prvMgr', 'manager');
    expect((await ctx.http().post(`/privacy/leads/${leadId}/erase`).set(auth(manager.accessToken)).send({ reason: 'DSR-2 request', confirm: 'ERASE' })).status).toBe(403);
    expect((await ctx.http().post(`/privacy/leads/${leadId}/erase`).set(auth(other.accessToken)).send({ reason: 'DSR-3 other tenant', confirm: 'ERASE' })).status).toBe(404);
    expect((await ctx.http().get(`/leads/${leadId}`).set(auth(t.accessToken))).status).toBe(200); // nothing happened yet

    const done = await ctx.http().post(`/privacy/leads/${leadId}/erase`).set(auth(t.accessToken)).send({ reason: 'DSR-2026-001 data principal request', confirm: 'ERASE' });
    expect(done.status).toBe(200); expect(done.body.counts).toMatchObject({ leads: 1, conversations: 1 }); expect(done.body.counts.consents).toBeGreaterThanOrEqual(1); expect(done.body.counts.messages).toBeGreaterThanOrEqual(1);

    expect((await ctx.http().get(`/leads/${leadId}`).set(auth(t.accessToken))).status).toBe(404);
    expect(await count('leads', 'id', [leadId])).toBe(0); expect(await count('conversations', 'id', [conversationId])).toBe(0);
    expect(await count('messages', 'conversation_id', [conversationId])).toBe(0); expect(await count('lead_notes', 'lead_id', [leadId])).toBe(0);
    expect(await count('lead_activities', 'lead_id', [leadId])).toBe(0); expect(await count('consents', 'lead_id', [leadId])).toBe(0); expect(await count('tasks', 'lead_id', [leadId])).toBe(0);
    expect((await q(`SELECT count(*)::int n FROM webhook_events WHERE tenant_id = $1 AND payload::text LIKE $2`, [t.tenantId, `%${phone}%`])).rows[0].n).toBe(0);
    // an unrelated person is untouched
    expect(await count('leads', 'id', [keep.leadId])).toBe(1); expect(await count('messages', 'conversation_id', [keep.conversationId])).toBeGreaterThan(0);
    // the audit trail records that it happened, with no personal content
    const audit = (await q(`SELECT metadata FROM audit_logs WHERE tenant_id = $1 AND action = 'privacy.lead_erased' AND resource_id = $2`, [t.tenantId, leadId])).rows;
    expect(audit).toHaveLength(1); expect(JSON.stringify(audit[0].metadata)).not.toMatch(/private|Erase Me|interested/);
    // erasing twice is a clean 404
    expect((await ctx.http().post(`/privacy/leads/${leadId}/erase`).set(auth(t.accessToken)).send({ reason: 'DSR-2026-001 again', confirm: 'ERASE' })).status).toBe(404);
  });

  it('refuses an export for anyone without the export permission (agents)', async () => {
    const agent = await addMember(ctx, t, 'prvAgent', 'agent');
    const mine = await ctx.http().post('/leads').set(auth(agent.accessToken)).send({ name: 'Agent Lead', phone: '+919800000222' });
    expect((await ctx.http().get(`/privacy/leads/${mine.body.id}/export`).set(auth(agent.accessToken))).status).toBe(403);
  });

  it('the application role cannot delete personal data directly: only the audited function can', async () => {
    const app = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await expect(app.query('DELETE FROM consents')).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM messages')).rejects.toThrow(/permission denied/);
    await app.end();
  });
});
