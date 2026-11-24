import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Audit finding S-20: erase_lead() did not touch email tracking. tracked_emails.lead_id is ON DELETE SET NULL, so after an erasure the person's
 * address, subject lines and engagement trail (IP, user-agent, clicked URLs) were still stored. Fixtures are written with the OWNER role.
 */
let ctx: TestCtx; let db: pg.Pool; let t: Account;
const q = (sql: string, p: unknown[] = []) => db.query(sql, p);

beforeAll(async () => {
  ctx = await createTestApp();
  db = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  t = await registerAccount(ctx, 'emailErase');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', t.email)?.token });
});
afterAll(async () => {
  await q('DELETE FROM email_engagement_events WHERE tenant_id = $1', [t.tenantId]);
  await q('DELETE FROM tracked_emails WHERE tenant_id = $1', [t.tenantId]);
  await q('DELETE FROM email_suppressions WHERE tenant_id = $1', [t.tenantId]);
  await db.end(); await ctx.close(); await cleanup();
});

const lead = async (name: string, phone: string, email: string) => (await ctx.http().post('/leads').set(auth(t.accessToken)).send({ name, phone, email })).body.id as string;
const email = async (leadId: string | null, to: string) => {
  const id = randomUUID();
  await q(`INSERT INTO tracked_emails (id, tenant_id, lead_id, recipient, subject, status, updated_at) VALUES ($1, $2, $3, $4, 'Your site visit', 'SENT', now())`, [id, t.tenantId, leadId, to]);
  await q(`INSERT INTO email_engagement_events (id, tenant_id, email_id, type, ip_address, user_agent, click_url) VALUES (gen_random_uuid(), $1, $2, 'CLICK', '203.0.113.7', 'Mozilla/5.0', 'https://example.test/brochure')`, [t.tenantId, id]);
  return id;
};
const exists = async (table: string, id: string) => ((await q(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount ?? 0) > 0;

describe('DPDP erasure covers email tracking', () => {
  it('deletes emails sent to the person (linked to the lead OR only by address) with their engagement trail, and spares everyone else', async () => {
    const target = await lead('Erase Me', '+919800000901', 'Erase.Me@example.test');
    const bystander = await lead('Keep Me', '+919800000902', 'keep.me@example.test');
    const linked = await email(target, 'erase.me@example.test');
    const byAddressOnly = await email(null, 'ERASE.ME@example.test'); // sent without choosing a lead, still to this person (case-insensitive)
    const others = await email(bystander, 'keep.me@example.test');
    const unlinked = await email(null, 'someone.else@example.test');
    await q(`INSERT INTO email_suppressions (id, tenant_id, email, reason, source, notes) VALUES (gen_random_uuid(), $1, 'erase.me@example.test', 'COMPLAINT', 'ses', 'angry about the price, called twice')`, [t.tenantId]);

    // the access request shows the same data that erasure will remove: the emails, what tracking recorded, and the suppression entry
    const exp = await ctx.http().get(`/privacy/leads/${target}/export`).set(auth(t.accessToken));
    expect(exp.status).toBe(200);
    expect(exp.body.emails.map((e: { id: string }) => e.id).sort()).toEqual([linked, byAddressOnly].sort());
    expect(exp.body.emails[0].events[0]).toMatchObject({ type: 'CLICK', ipAddress: '203.0.113.7', clickUrl: 'https://example.test/brochure' });
    expect(exp.body.emailSuppressions).toHaveLength(1);
    expect(JSON.stringify(exp.body)).not.toContain('keep.me@example.test'); // nobody else's mail

    const res = await ctx.http().post(`/privacy/leads/${target}/erase`).set(auth(t.accessToken)).send({ reason: 'DSR-EMAIL request', confirm: 'ERASE' });
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ tracked_emails: 2, email_engagement_events: 2, email_suppressions_retained: 1 });

    expect(await exists('tracked_emails', linked)).toBe(false);
    expect(await exists('tracked_emails', byAddressOnly)).toBe(false);
    expect((await q('SELECT count(*)::int n FROM email_engagement_events WHERE email_id = ANY($1::uuid[])', [[linked, byAddressOnly]])).rows[0].n).toBe(0);
    expect(await exists('tracked_emails', others)).toBe(true);
    expect(await exists('tracked_emails', unlinked)).toBe(true);
    expect((await q('SELECT count(*)::int n FROM email_engagement_events WHERE email_id = ANY($1::uuid[])', [[others, unlinked]])).rows[0].n).toBe(2);
    expect((await q(`SELECT count(*)::int n FROM tracked_emails WHERE tenant_id = $1 AND recipient = 'erase.me@example.test'`, [t.tenantId])).rows[0].n).toBe(0);
  });

  it('keeps the suppression entry (it is how a complaint keeps being honoured) but clears its free-text notes', async () => {
    const row = (await q(`SELECT email, reason, notes FROM email_suppressions WHERE tenant_id = $1 AND email = 'erase.me@example.test'`, [t.tenantId])).rows[0];
    expect(row).toMatchObject({ reason: 'COMPLAINT', notes: null });
  });
});

describe('guard: nothing that references a lead can survive an erasure unnoticed', () => {
  it('every table with a lead_id column deletes with the lead, except those erase_lead() handles itself', async () => {
    const HANDLED_BY_ERASE_LEAD = ['tracked_emails'];
    const { rows } = await q(`
      SELECT c.relname AS tbl,
        (SELECT CASE k.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END
           FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.confrelid = 'leads'::regclass AND a.attnum = ANY (k.conkey) LIMIT 1) AS rule
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND a.attname = 'lead_id' AND NOT a.attisdropped ORDER BY 1`);
    const risky = rows.filter((r) => r.rule !== 'CASCADE' && !HANDLED_BY_ERASE_LEAD.includes(r.tbl)).map((r) => `${r.tbl} (${r.rule ?? 'no foreign key'})`);
    expect(risky, 'a table references leads without cascading: add it to erase_lead() and to HANDLED_BY_ERASE_LEAD').toEqual([]);
  });
});
