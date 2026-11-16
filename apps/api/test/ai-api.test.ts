import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/ai/knowledge/storage.js';
import { KnowledgeService } from '../src/ai/knowledge/knowledge.service.js';
import { ClamAvScanner, EICAR, MockScanner, ScannerUnavailableError } from '../src/ai/knowledge/virus-scan.js';
import { ScoringService } from '../src/ai/scoring/scoring.service.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';
import { makeDocx, makePdf } from './fixtures.js';

let ctx: TestCtx; let owner: Account; let manager: Account; let agent: Account; let other: Account; let owner$: pg.Pool;
let knowledge: KnowledgeService; let storage: ObjectStorage; let scanner: MockScanner;

beforeAll(async () => {
  ctx = await createTestApp();
  knowledge = ctx.app.get(KnowledgeService); storage = ctx.app.get(OBJECT_STORAGE); scanner = ctx.app.get(MockScanner);
  owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'aiOwner'); other = await registerAccount(ctx, 'aiOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  manager = await addMember(ctx, owner, 'aiManager', 'manager'); agent = await addMember(ctx, owner, 'aiAgent', 'agent');
});
afterAll(async () => { await knowledge.idle(); await ctx.app.get(ScoringService).idle(); await owner$.end(); await ctx.close(); await cleanup(); });

const upload = (t: Account, name: string, data: Buffer, type: string, fields: Record<string, string> = {}) => { const r = ctx.http().post('/knowledge/documents').set(auth(t.accessToken)); for (const [k, v] of Object.entries(fields)) r.field(k, v); return r.attach('file', data, { filename: name, contentType: type }); };
const docKey = async (id: string) => (await owner$.query('SELECT storage_key FROM knowledge_documents WHERE id=$1', [id])).rows[0]?.storage_key as string;

describe('real antivirus (ClamAV over TCP)', () => {
  const env = { CLAMAV_HOST: process.env.CLAMAV_HOST ?? 'localhost', CLAMAV_PORT: Number(process.env.CLAMAV_PORT ?? 3310) } as never;
  it('flags the EICAR test file and passes clean content', async () => {
    const clam = new ClamAvScanner(env);
    const bad = await clam.scan(Buffer.from(EICAR));
    expect(bad).toMatchObject({ clean: false }); expect((bad as { threat: string }).threat).toMatch(/eicar/i);
    expect(await clam.scan(Buffer.from('Just a normal brochure text.'))).toEqual({ clean: true });
  });
  it('fails closed when the scanner cannot be reached', async () => {
    await expect(new ClamAvScanner({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: 1 } as never).scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});

describe('assistant settings', () => {
  const base = { enabled: false, name: 'Asha', businessIdentity: 'Skyline Realty', businessDescription: 'Premium homes in Pune.', languages: ['en', 'hinglish'], tone: 'friendly', welcomeMessage: 'Namaste!', systemInstructions: 'Mention the clubhouse.', workingHours: { enabled: true, days: { mon: { start: '10:00', end: '19:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }, handoverRules: { keywords: ['human', 'manager'], onNegotiation: true, onComplaint: true }, allowedTools: ['get_business_info', 'search_properties', 'update_lead', 'handover_to_human'], model: null, temperature: 0.3, maxReplyChars: 500, fallbackMessage: 'A team member will reply soon.', disclosureText: 'I am an automated assistant.', monthlyTokenCap: null };
  it('is owner-only, created lazily with safe defaults (disabled), and never exposes secrets', async () => {
    expect((await ctx.http().get('/ai/assistant').set(auth(agent.accessToken))).status).toBe(403);
    const g = await ctx.http().get('/ai/assistant').set(auth(owner.accessToken));
    expect(g.status).toBe(200); expect(g.body).toMatchObject({ enabled: false, provider: 'mock', killSwitch: false });
    expect(g.body.allowedTools).not.toContain('assign_agent'); expect(JSON.stringify(g.body)).not.toMatch(/api.?key|secret/i);
  });
  it('validates input, refuses unknown tools, and records an audit entry', async () => {
    const put = (b: object, t = owner) => ctx.http().put('/ai/assistant').set(auth(t.accessToken)).send(b);
    expect((await put(base, agent)).status).toBe(403); expect((await put(base, manager)).status).toBe(403);
    expect((await put({ ...base, name: '' })).status).toBe(400);
    expect((await put({ ...base, allowedTools: ['create_appointment', 'check_availability'] })).status).toBe(200); // scheduling tools are available since phase 5
    expect((await put({ ...base, allowedTools: ['transfer_money'] })).status).toBe(400);
    expect((await put({ ...base, allowedTools: ['drop_database'] })).status).toBe(400);
    expect((await put({ ...base, temperature: 5 })).status).toBe(400);
    expect((await put({ ...base, workingHours: { ...base.workingHours, days: { ...base.workingHours.days, mon: { start: '25:00', end: '19:00' } } } })).status).toBe(400);
    const ok = await put({ ...base, enabled: true });
    expect(ok.status).toBe(200); expect(ok.body.enabled).toBe(true);
    const audit = await ctx.http().get('/audit-logs?action=ai.assistant_configured').set(auth(owner.accessToken));
    expect(audit.body.items[0].metadata).toMatchObject({ enabled: true, enabledChanged: true });
    await put({ ...base, enabled: false });
  });
  it('reports token usage against the cap with a warning threshold', async () => {
    const u = await ctx.http().get('/ai/usage').set(auth(owner.accessToken));
    expect(u.body).toMatchObject({ used: 0, exceeded: false, warning: false }); expect(u.body.cap).toBeGreaterThan(0);
  });
});

describe('knowledge base: upload pipeline', () => {
  const policy = 'Home loan documents: you need identity proof, address proof and the last six months of salary slips. Our partner banks usually approve within a week.\n\nParking: every 3 BHK unit includes two covered parking slots.';
  it('accepts txt, csv, docx and pdf, indexes them (pgvector) and stores the file under the tenant prefix', async () => {
    const files: [string, Buffer, string][] = [
      ['loan-faq.txt', Buffer.from(policy), 'text/plain'],
      ['amenities.csv', Buffer.from('amenity,details\nSwimming pool,Open 6am to 9pm for residents\nGym,Fully equipped gym on the 2nd floor with a trainer'), 'text/csv'],
      ['policy.docx', makeDocx(['Cancellation policy: bookings can be cancelled within 15 days for a full refund of the token amount.']), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['brochure.pdf', makePdf('Greenfield Heights offers spacious homes with a landscaped garden and a rooftop clubhouse for residents'), 'application/pdf'],
    ];
    const ids: string[] = [];
    for (const [name, data, type] of files) { const r = await upload(owner, name, data, type, { category: 'faq' }); expect(r.status, name).toBe(201); expect(r.body.status).toBe('PENDING'); ids.push(r.body.id); }
    await knowledge.idle();
    const list = await ctx.http().get('/knowledge/documents').set(auth(owner.accessToken));
    expect(list.body.map((d: { status: string }) => d.status)).toEqual(['READY', 'READY', 'READY', 'READY']);
    for (const d of list.body) expect(d.chunkCount).toBeGreaterThan(0);
    for (const id of ids) { const key = await docKey(id); expect(key.startsWith(`tenants/${owner.tenantId}/knowledge/${id}/`)).toBe(true); expect((await storage.get(key)).length).toBeGreaterThan(10); }
    const d = await ctx.http().get(`/knowledge/documents/${ids[2]}`).set(auth(owner.accessToken));
    expect(d.body.preview.join(' ')).toContain('Cancellation policy');
  });
  it('retrieves the right passage with semantic search, scoped to the tenant', async () => {
    const r = await ctx.http().post('/knowledge/search').set(auth(owner.accessToken)).send({ q: 'what documents are needed for a home loan?' });
    expect(r.status).toBe(200); expect(r.body[0].title).toBe('loan-faq'); expect(r.body[0].content).toContain('salary slips'); expect(r.body[0].score).toBeGreaterThan(0.2);
    const clubhouse = await ctx.http().post('/knowledge/search').set(auth(owner.accessToken)).send({ q: 'is there a clubhouse' });
    expect(clubhouse.body[0].title).toBe('brochure');
    expect((await ctx.http().post('/knowledge/search').set(auth(other.accessToken)).send({ q: 'home loan documents' })).body).toEqual([]);
    expect((await ctx.http().post('/knowledge/search').set(auth(owner.accessToken)).send({ q: 'x' })).status).toBe(400);
  });
  it('rejects unsupported, mislabelled, oversized and malicious files and stores nothing for them', async () => {
    const before = (await owner$.query('SELECT count(*)::int n FROM knowledge_documents WHERE tenant_id=$1', [owner.tenantId])).rows[0].n;
    expect((await upload(owner, 'run.exe', Buffer.from('MZ\x90\x00'), 'application/octet-stream')).body.error.code).toBe('unsupported_file');
    expect((await upload(owner, 'fake.pdf', Buffer.from('<html>not a pdf</html>'), 'application/pdf')).body.error.code).toBe('unsupported_file');
    expect((await upload(owner, 'sneaky.txt', Buffer.from('MZ\x90\x00\x03'), 'text/plain')).body.error.code).toBe('unsupported_file');
    expect((await upload(owner, 'page.html', Buffer.from('<script>alert(1)</script>'), 'text/html')).status).toBe(422);
    const big = await upload(owner, 'huge.txt', Buffer.alloc(10 * 1024 * 1024 + 1000, 97), 'text/plain');
    expect([413, 400]).toContain(big.status);
    const eicar = await upload(owner, 'eicar.txt', Buffer.from(EICAR), 'text/plain');
    expect(eicar.status).toBe(422); expect(eicar.body.error.code).toBe('malware_detected');
    expect((await owner$.query('SELECT count(*)::int n FROM knowledge_documents WHERE tenant_id=$1', [owner.tenantId])).rows[0].n).toBe(before);
    expect((await ctx.http().get('/audit-logs?action=knowledge.upload_blocked').set(auth(owner.accessToken))).body.items.length).toBe(1);
  });
  it('fails closed when the virus scanner is down: the upload is refused and nothing is stored', async () => {
    scanner.unavailable = true;
    const before = (await owner$.query('SELECT count(*)::int n FROM knowledge_documents WHERE tenant_id=$1', [owner.tenantId])).rows[0].n;
    const r = await upload(owner, 'while-down.txt', Buffer.from('some harmless notes about our projects'), 'text/plain');
    scanner.unavailable = false;
    expect(r.status).toBe(503); expect(r.body.error.code).toBe('scanner_unavailable');
    expect((await owner$.query('SELECT count(*)::int n FROM knowledge_documents WHERE tenant_id=$1', [owner.tenantId])).rows[0].n).toBe(before);
  });
  it('records a failed document with a safe message and lets it be reprocessed', async () => {
    const empty = await upload(owner, 'blank.txt', Buffer.from('   \n  '), 'text/plain');
    await knowledge.idle();
    const d = await ctx.http().get(`/knowledge/documents/${empty.body.id}`).set(auth(owner.accessToken));
    expect(d.body.status).toBe('FAILED'); expect(d.body.error).toMatch(/readable text/);
    const re = await ctx.http().post(`/knowledge/documents/${empty.body.id}/reprocess`).set(auth(owner.accessToken));
    expect(re.status).toBe(202); await knowledge.idle();
    expect((await ctx.http().get(`/knowledge/documents/${empty.body.id}`).set(auth(owner.accessToken))).body.status).toBe('FAILED');
  });
  it('is restricted to knowledge managers and isolated between tenants (404, never a leak)', async () => {
    const mine = (await ctx.http().get('/knowledge/documents').set(auth(owner.accessToken))).body[0].id;
    expect((await ctx.http().get('/knowledge/documents').set(auth(agent.accessToken))).status).toBe(403);
    expect((await upload(agent, 'a.txt', Buffer.from('agent upload attempt text'), 'text/plain')).status).toBe(403);
    expect((await ctx.http().get('/knowledge/documents').set(auth(other.accessToken))).body).toEqual([]);
    for (const [m, p] of [['get', `/knowledge/documents/${mine}`], ['get', `/knowledge/documents/${mine}/download`], ['delete', `/knowledge/documents/${mine}`], ['post', `/knowledge/documents/${mine}/reprocess`]] as const) expect((await ctx.http()[m](p).set(auth(other.accessToken))).status, `${m} ${p}`).toBe(404);
    expect((await ctx.http().patch(`/knowledge/documents/${mine}`).set(auth(other.accessToken)).send({ title: 'pwned' })).status).toBe(404);
  });
  it('downloads as an attachment, renames, and deletes: chunks and the stored object are removed and search forgets it', async () => {
    const docs = (await ctx.http().get('/knowledge/documents').set(auth(owner.accessToken))).body;
    const loan = docs.find((d: { filename: string }) => d.filename === 'loan-faq.txt');
    const dl = await ctx.http().get(`/knowledge/documents/${loan.id}/download`).set(auth(owner.accessToken));
    expect(dl.headers['content-disposition']).toContain('attachment'); expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((await ctx.http().patch(`/knowledge/documents/${loan.id}`).set(auth(owner.accessToken)).send({ title: 'Loan FAQ' })).body.title).toBe('Loan FAQ');
    const key = await docKey(loan.id);
    expect((await ctx.http().delete(`/knowledge/documents/${loan.id}`).set(auth(owner.accessToken))).status).toBe(204);
    await expect(storage.get(key)).rejects.toThrow();
    expect((await owner$.query('SELECT count(*)::int n FROM knowledge_chunks WHERE document_id=$1', [loan.id])).rows[0].n).toBe(0);
    expect((await ctx.http().post('/knowledge/search').set(auth(owner.accessToken)).send({ q: 'home loan salary slips' })).body.every((h: { title: string }) => h.title !== 'Loan FAQ')).toBe(true);
    expect((await ctx.http().get(`/knowledge/documents/${loan.id}`).set(auth(owner.accessToken))).status).toBe(404);
  });
});

describe('lead scoring API', () => {
  const mk = (t: Account, b: object) => ctx.http().post('/leads').set(auth(t.accessToken)).send(b);
  it('scores a lead automatically as details arrive, with an explanation and history', async () => {
    const l = (await mk(owner, { name: 'Scored Lead', phone: '9811200001' })).body;
    expect(l.score).toBe(0); expect(l.temperature).toBe('UNKNOWN');
    const up = await ctx.http().patch(`/leads/${l.id}`).set(auth(owner.accessToken)).send({ budgetMax: 9_000_000, location: 'Baner', buyingTimeline: 'WITHIN_30_DAYS' });
    expect(up.body.score).toBe(60); expect(up.body.temperature).toBe('WARM');
    const v = await ctx.http().get(`/leads/${l.id}/score`).set(auth(owner.accessToken));
    expect(v.body.breakdown.map((b: { state: string }) => b.state)).toEqual(['met', 'met', 'met', 'unknown', 'unknown']);
    expect(v.body.history.length).toBe(2); expect(v.body.overridden).toBe(false);
    expect((await ctx.http().get(`/leads/${l.id}/score`).set(auth(other.accessToken))).status).toBe(404);
  });
  it('lets managers override with a mandatory reason; the override survives automatic re-scoring until cleared; all audited', async () => {
    const l = (await mk(owner, { name: 'Override Lead', phone: '9811200002' })).body;
    const ov = (t: Account, b: object) => ctx.http().post(`/leads/${l.id}/score/override`).set(auth(t.accessToken)).send(b);
    expect((await ov(agent, { score: 90, reason: 'seems keen' })).status).toBe(403);
    expect((await ov(manager, { score: 90 })).status).toBe(400); expect((await ov(manager, { score: 120, reason: 'too high' })).status).toBe(400); expect((await ov(manager, { score: 90, reason: 'x' })).status).toBe(400);
    expect((await ov(other, { score: 90, reason: 'not mine' })).status).toBe(404);
    expect((await ov(manager, { score: 90, reason: 'Customer called the office, ready to pay token' })).body).toMatchObject({ score: 90, temperature: 'HOT', overridden: true });
    await ctx.http().patch(`/leads/${l.id}`).set(auth(owner.accessToken)).send({ location: 'Wakad' }); // triggers automatic re-scoring
    const v = (await ctx.http().get(`/leads/${l.id}/score`).set(auth(owner.accessToken))).body;
    expect(v).toMatchObject({ score: 90, overridden: true, automaticScore: 15 });
    expect(v.history.find((h: { source: string }) => h.source === 'MANUAL')).toMatchObject({ reason: 'Customer called the office, ready to pay token', actor: 'User aiManager' });
    expect((await ctx.http().get('/audit-logs?action=lead.score_overridden').set(auth(owner.accessToken))).body.items[0].metadata).toMatchObject({ to: 90 });
    expect((await ctx.http().delete(`/leads/${l.id}/score/override`).set(auth(agent.accessToken))).status).toBe(403);
    expect((await ctx.http().delete(`/leads/${l.id}/score/override`).set(auth(manager.accessToken))).body).toMatchObject({ score: 15 });
    expect((await ctx.http().delete(`/leads/${l.id}/score/override`).set(auth(manager.accessToken))).status).toBe(400);
  });
  it('lets the owner change the rules (versioned, audited) and re-scores existing leads; managers cannot', async () => {
    const l = (await mk(owner, { name: 'Rules Lead', phone: '9811200003', budgetMax: 5_000_000 })).body;
    expect(l.score).toBe(15);
    const rules = (await ctx.http().get('/scoring/rules').set(auth(agent.accessToken))).body;
    expect(rules.version).toBe(0);
    const next = { ...rules.rules, criteria: rules.rules.criteria.map((c: { key: string; points: number }) => (c.key === 'budget_known' ? { ...c, points: 40 } : c)), hotMin: 60 };
    expect((await ctx.http().put('/scoring/rules').set(auth(manager.accessToken)).send(next)).status).toBe(403);
    expect((await ctx.http().put('/scoring/rules').set(auth(owner.accessToken)).send({ ...next, warmMin: 70, hotMin: 60 })).status).toBe(400);
    const saved = await ctx.http().put('/scoring/rules').set(auth(owner.accessToken)).send(next);
    expect(saved.body.version).toBe(1);
    await ctx.app.get(ScoringService).idle();
    expect((await ctx.http().get(`/leads/${l.id}`).set(auth(owner.accessToken))).body.score).toBe(40);
    expect((await ctx.http().get('/audit-logs?action=ai.scoring_rules_changed').set(auth(owner.accessToken))).body.items.length).toBe(1);
    expect((await ctx.http().get('/scoring/rules').set(auth(other.accessToken))).body.version).toBe(0); // other tenant unaffected
  });
});
