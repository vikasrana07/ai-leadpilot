import 'reflect-metadata';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateConsent, phoneSuppressionHash } from '../src/campaigns/consent.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Consent ledger: every decision is provable (who, how, when, wording, evidence), an opt-out can only be lifted by an explicit opt-in,
 * and an opt-out survives lead erasure. Ledger fixtures that need back-dating are written with the OWNER role; everything else is HTTP + RLS.
 */
let ctx: TestCtx; let owner$: pg.Pool; let app$: pg.Pool;
let owner: Account; let agent: Account; let other: Account;
let apiKey = '';
const base = String(Date.now()).slice(-6);
const phone = (n: number) => `+9199${base}${String(n).padStart(2, '0')}`;
const q = (sql: string, p: unknown[] = []) => owner$.query(sql, p);
const mkLead = async (token: string, n: number, extra: object = {}) => {
  const res = await ctx.http().post('/leads').set(auth(token)).send({ name: `Consent ${n}`, phone: phone(n), ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
};
const consents = (token: string, leadId: string) => ctx.http().get(`/leads/${leadId}/consents`).set(auth(token));
const record = (token: string, leadId: string, body: object) => ctx.http().post(`/leads/${leadId}/consents`).set(auth(token)).send(body);

beforeAll(async () => {
  ctx = await createTestApp();
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  app$ = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await registerAccount(ctx, 'ledgerOwner'); other = await registerAccount(ctx, 'ledgerOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', other.email)?.token });
  agent = await addMember(ctx, owner, 'ledgerAgent', 'agent');
  apiKey = (await ctx.http().post('/api-keys').set(auth(owner.accessToken)).send({ name: 'Ledger form' })).body.key;
});
afterAll(async () => { await owner$.end(); await app$.end(); await ctx.close(); await cleanup(); });

describe('evaluateConsent (pure rules)', () => {
  const row = (status: 'OPTED_IN' | 'OPTED_OUT', purpose: 'SERVICE' | 'MARKETING' | 'TRANSACTIONAL', expiresAt: Date | null = null) => ({ status, purpose, expiresAt });
  it('needs an explicit MARKETING opt-in for marketing; a customer message is only SERVICE consent', () => {
    expect(evaluateConsent([], 'MARKETING')).toBe('NO_CONSENT');
    expect(evaluateConsent([row('OPTED_IN', 'SERVICE')], 'SERVICE')).toBe('ELIGIBLE');
    expect(evaluateConsent([row('OPTED_IN', 'SERVICE')], 'MARKETING')).toBe('NO_CONSENT');
    expect(evaluateConsent([row('OPTED_IN', 'MARKETING')], 'MARKETING')).toBe('ELIGIBLE');
  });
  it('an opt-out wins over everything older, and only a NEWER opt-in lifts it', () => {
    expect(evaluateConsent([row('OPTED_OUT', 'MARKETING'), row('OPTED_IN', 'MARKETING')], 'MARKETING')).toBe('OPTED_OUT');
    expect(evaluateConsent([row('OPTED_OUT', 'MARKETING'), row('OPTED_IN', 'SERVICE')], 'SERVICE')).toBe('OPTED_OUT');
    expect(evaluateConsent([row('OPTED_IN', 'MARKETING'), row('OPTED_OUT', 'MARKETING'), row('OPTED_IN', 'MARKETING')], 'MARKETING')).toBe('ELIGIBLE');
    // an opt-in older than a STOP never counts for marketing even if a newer SERVICE row exists
    expect(evaluateConsent([row('OPTED_IN', 'SERVICE'), row('OPTED_OUT', 'MARKETING'), row('OPTED_IN', 'MARKETING')], 'MARKETING')).toBe('NO_CONSENT');
  });
  it('ignores expired opt-ins but never expires an opt-out; the erasure suppression list only applies with no ledger rows', () => {
    const past = new Date(Date.now() - 1000);
    expect(evaluateConsent([row('OPTED_IN', 'MARKETING', past)], 'MARKETING')).toBe('NO_CONSENT');
    expect(evaluateConsent([row('OPTED_OUT', 'MARKETING', past)], 'MARKETING')).toBe('OPTED_OUT');
    expect(evaluateConsent([], 'SERVICE', true)).toBe('OPTED_OUT');
    expect(evaluateConsent([row('OPTED_IN', 'MARKETING')], 'MARKETING', true)).toBe('ELIGIBLE'); // an explicit opt-in after erasure is honoured
  });
});

describe('capture records proof', () => {
  it('manual create with consent writes a ledger row with who, how, wording and evidence', async () => {
    const id = await mkLead(owner.accessToken, 1, { consent: { whatsappMarketing: true, method: 'FORM_CHECKBOX', textVersion: 'v2-2026-11' } });
    const res = await consents(owner.accessToken, id);
    expect(res.status).toBe(200);
    expect(res.body.whatsapp).toEqual({ service: 'ELIGIBLE', marketing: 'ELIGIBLE' });
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ status: 'OPTED_IN', purpose: 'MARKETING', method: 'FORM_CHECKBOX', actorType: 'MEMBER', textVersion: 'v2-2026-11', actor: 'User ledgerOwner' });
    const tl = (await ctx.http().get(`/leads/${id}/activity`).set(auth(owner.accessToken))).body as { type: string }[];
    expect(tl.some((a) => a.type === 'consent_changed')).toBe(true);
    const audit = await q(`SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'consent.opted_in' AND resource_id = $2`, [owner.tenantId, id]);
    expect(audit.rowCount).toBe(1);
  });

  it('a lead created without consent is not eligible for marketing', async () => {
    const id = await mkLead(owner.accessToken, 2);
    const res = await consents(owner.accessToken, id);
    expect(res.body.whatsapp).toEqual({ service: 'NO_CONSENT', marketing: 'NO_CONSENT' });
    expect(res.body.history).toEqual([]);
  });

  it('API-key capture records the key and caller IP as evidence, and never overrides an opt-out', async () => {
    const ph = phone(3);
    const r = await ctx.http().post('/public/leads').set('x-api-key', apiKey).send({ name: 'Web Form', phone: ph, consent: { whatsappMarketing: true, method: 'FORM_CHECKBOX', textVersion: 'site-v1' } });
    expect(r.status).toBe(201);
    const h = (await consents(owner.accessToken, r.body.id)).body.history[0];
    expect(h).toMatchObject({ status: 'OPTED_IN', purpose: 'MARKETING', method: 'FORM_CHECKBOX', actorType: 'SYSTEM', textVersion: 'site-v1' });
    expect(h.evidence.apiKeyId).toBeTruthy();
    // the person later opts out, then the same site form is submitted again with the checkbox ticked: the opt-out stands
    expect((await record(owner.accessToken, r.body.id, { status: 'OPTED_OUT', reason: 'asked not to be contacted' })).status).toBe(200);
    const again = await ctx.http().post('/public/leads').set('x-api-key', apiKey).send({ name: 'Web Form', phone: ph, consent: { whatsappMarketing: true } });
    expect(again.body.duplicate).toBe(true);
    expect((await consents(owner.accessToken, r.body.id)).body.whatsapp.marketing).toBe('OPTED_OUT');
  });

  it('CSV import records consent only when the importer attests they hold proof', async () => {
    const csv = (n: number) => `name,phone,whatsapp_consent\nCsv Yes ${n},${phone(10 + n)},yes\nCsv No ${n},${phone(20 + n)},\n`;
    const without = await ctx.http().post('/leads/import').set(auth(owner.accessToken)).send({ csv: csv(1), dryRun: false });
    expect(without.status).toBe(200);
    expect(without.body).toMatchObject({ created: 2, consentRecorded: 0, consentIgnored: 1 });
    const withAtt = await ctx.http().post('/leads/import').set(auth(owner.accessToken)).send({ csv: csv(2), dryRun: false, consentAttestation: true });
    expect(withAtt.body).toMatchObject({ created: 2, consentRecorded: 1, consentIgnored: 0 });
    const rows = await q(`SELECT c.method, c.purpose, c.evidence FROM consents c JOIN leads l ON l.id = c.lead_id WHERE c.tenant_id = $1 AND l.phone_norm = $2`, [owner.tenantId, `91${phone(12).slice(3)}`]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ method: 'CSV_IMPORT', purpose: 'MARKETING' });
    expect(rows.rows[0].evidence.importBatchId).toBeTruthy();
    const none = await q(`SELECT 1 FROM consents c JOIN leads l ON l.id = c.lead_id WHERE c.tenant_id = $1 AND l.phone_norm = $2`, [owner.tenantId, `91${phone(11).slice(3)}`]);
    expect(none.rowCount).toBe(0);
  });
});

describe('recording decisions on a lead', () => {
  it('an agent can record an opt-out on their own lead but cannot record a marketing opt-in', async () => {
    const id = await mkLead(agent.accessToken, 30);
    expect((await record(agent.accessToken, id, { status: 'OPTED_IN', basis: 'verbal_recorded', attestation: true })).status).toBe(403);
    expect((await record(agent.accessToken, id, { status: 'OPTED_OUT', reason: 'told me on the phone' })).status).toBe(200);
    const h = (await consents(agent.accessToken, id)).body;
    expect(h.whatsapp).toEqual({ service: 'OPTED_OUT', marketing: 'OPTED_OUT' });
    expect(h.history[0]).toMatchObject({ status: 'OPTED_OUT', evidence: { reason: 'told me on the phone' } });
  });

  it('a manager attestation needs an explicit attestation, and can never override an opt-out', async () => {
    const id = await mkLead(owner.accessToken, 31);
    expect((await record(owner.accessToken, id, { status: 'OPTED_IN', basis: 'existing_customer' })).status).toBe(400);
    expect((await record(owner.accessToken, id, { status: 'OPTED_IN', basis: 'existing_customer', attestation: true })).status).toBe(200);
    expect((await consents(owner.accessToken, id)).body.whatsapp.marketing).toBe('ELIGIBLE');
    await record(owner.accessToken, id, { status: 'OPTED_OUT', reason: 'unsubscribed by phone' });
    const blocked = await record(owner.accessToken, id, { status: 'OPTED_IN', basis: 'existing_customer', attestation: true });
    expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('opted_out');
  });

  it('is tenant-scoped: another workspace gets 404 for both reading and writing', async () => {
    const id = await mkLead(owner.accessToken, 32);
    expect((await consents(other.accessToken, id)).status).toBe(404);
    expect((await record(other.accessToken, id, { status: 'OPTED_OUT', reason: 'not mine to change' })).status).toBe(404);
  });
});

describe('the ledger is append-only and an opt-out survives erasure', () => {
  it('the application role cannot update or delete consent rows', async () => {
    const id = await mkLead(owner.accessToken, 40, { consent: { whatsappMarketing: true } });
    await expect(app$.query(`UPDATE consents SET status = 'OPTED_OUT' WHERE lead_id = $1`, [id])).rejects.toThrow(/permission denied/i);
    await expect(app$.query(`DELETE FROM consents WHERE lead_id = $1`, [id])).rejects.toThrow(/permission denied/i);
  });

  it('erasing an opted-out lead keeps only a salted hash, and a re-added number starts opted out', async () => {
    const ph = phone(41);
    const id = await mkLead(owner.accessToken, 41, { consent: { whatsappMarketing: true } });
    await record(owner.accessToken, id, { status: 'OPTED_OUT', reason: 'STOP request' });
    const erased = await ctx.http().post(`/privacy/leads/${id}/erase`).set(auth(owner.accessToken)).send({ reason: 'DSR request from the customer', confirm: 'ERASE' });
    expect(erased.status).toBe(200);
    expect(erased.body.counts ?? erased.body).toMatchObject({ consent_suppressions_retained: 1 });
    expect((await q('SELECT count(*)::int n FROM consents WHERE lead_id = $1', [id])).rows[0].n).toBe(0);
    const norm = `91${ph.slice(3)}`;
    const hash = phoneSuppressionHash(owner.tenantId, norm);
    const sup = await q('SELECT phone_hash, reason FROM consent_suppressions WHERE tenant_id = $1', [owner.tenantId]);
    expect(sup.rows).toContainEqual({ phone_hash: hash, reason: 'erased_after_opt_out' });
    expect(JSON.stringify(sup.rows)).not.toContain(norm); // no readable number is kept

    const again = await mkLead(owner.accessToken, 41);
    expect((await consents(owner.accessToken, again)).body.whatsapp).toEqual({ service: 'OPTED_OUT', marketing: 'OPTED_OUT' });
    // and an explicit new opt-in by the customer (attested by a manager would be refused; the START keyword path lifts it) is a separate decision
    expect((await record(owner.accessToken, again, { status: 'OPTED_IN', basis: 'existing_customer', attestation: true })).status).toBe(409);
  });

  it('erasing a lead that never opted out keeps nothing', async () => {
    const id = await mkLead(owner.accessToken, 42, { consent: { whatsappMarketing: true } });
    const before = (await q('SELECT count(*)::int n FROM consent_suppressions WHERE tenant_id = $1', [owner.tenantId])).rows[0].n as number;
    expect((await ctx.http().post(`/privacy/leads/${id}/erase`).set(auth(owner.accessToken)).send({ reason: 'DSR request, no opt-out', confirm: 'ERASE' })).status).toBe(200);
    expect((await q('SELECT count(*)::int n FROM consent_suppressions WHERE tenant_id = $1', [owner.tenantId])).rows[0].n).toBe(before);
  });
});
