import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';
import { checkTransition, type StageLite } from '../src/leads/stage-rules.js';
import { parseMoney } from '../src/leads/lead-import.service.js';

let ctx: TestCtx;
let owner: Account; let manager: Account; let agent: Account; let agent2: Account; let otherOwner: Account;
let stages: Record<string, string> = {};
let reasons: string[] = [];
let memberIds: Record<string, string> = {};

const mk = (t: Account, body: Record<string, unknown>) => ctx.http().post('/leads').set(auth(t.accessToken)).send(body);

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'ldOwner');
  otherOwner = await registerAccount(ctx, 'ldOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  manager = await addMember(ctx, owner, 'ldManager', 'manager');
  agent = await addMember(ctx, owner, 'ldAgent', 'agent');
  agent2 = await addMember(ctx, owner, 'ldAgent2', 'agent');
  const board = await ctx.http().get('/pipeline/stages').set(auth(owner.accessToken));
  stages = Object.fromEntries(board.body.stages.map((s: { key: string; id: string }) => [s.key, s.id]));
  reasons = board.body.lostReasons.map((r: { id: string }) => r.id);
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  memberIds = Object.fromEntries(members.body.map((m: { user: { email: string }; id: string }) => [m.user.email, m.id]));
});
afterAll(async () => { await ctx.close(); await cleanup(); });

describe('stage transition rules (pure)', () => {
  const S = (id: string, kind: StageLite['kind'], canCloseWon = false, position = 0): StageLite => ({ id, name: id, kind, canCloseWon, position });
  const ok = { canReopen: false, hasLostReason: true };
  it('blocks winning from a stage that cannot close', () => { expect(checkTransition(S('a', 'OPEN'), S('w', 'WON'), ok)).toMatchObject({ ok: false, code: 'stage_transition_not_allowed' }); });
  it('allows winning from a closing stage', () => { expect(checkTransition(S('a', 'OPEN', true), S('w', 'WON'), ok)).toEqual({ ok: true }); });
  it('requires a reason to lose', () => { expect(checkTransition(S('a', 'OPEN'), S('l', 'LOST'), { ...ok, hasLostReason: false })).toMatchObject({ code: 'lost_reason_required' }); });
  it('reopening needs permission', () => {
    expect(checkTransition(S('l', 'LOST'), S('a', 'OPEN'), ok)).toMatchObject({ status: 403 });
    expect(checkTransition(S('l', 'LOST'), S('a', 'OPEN'), { ...ok, canReopen: true })).toEqual({ ok: true });
  });
  it('rejects a no-op move', () => { expect(checkTransition(S('a', 'OPEN'), S('a', 'OPEN'), ok)).toMatchObject({ code: 'same_stage' }); });
});

describe('money parsing', () => {
  it('understands Indian shorthand', () => {
    expect(parseMoney('₹1.2 Cr')).toBe(12_000_000); expect(parseMoney('85 L')).toBe(8_500_000); expect(parseMoney('85,00,000')).toBe(8_500_000);
    expect(parseMoney('50k')).toBe(50_000); expect(parseMoney('abc')).toBeNull();
  });
});

describe('lead CRUD, validation and duplicates', () => {
  it('creates a lead in the first stage with source, activity and normalised phone', async () => {
    const res = await mk(owner, { name: 'Vikram Desai', phone: '98765 43210', email: 'Vikram@Example.com', budgetMin: 8_500_000, budgetMax: 9_000_000, location: 'Wakad' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Vikram Desai', phone: '+919876543210', email: 'vikram@example.com', budgetMin: 8_500_000, stage: { key: 'new' }, source: { key: 'manual' } });
    const tl = await ctx.http().get(`/leads/${res.body.id}/activity`).set(auth(owner.accessToken));
    expect(tl.body.map((a: { type: string }) => a.type)).toContain('created');
  });
  it('validates input with field-level errors', async () => {
    const bad = await mk(owner, { name: '', budgetMin: 10, budgetMax: 5 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'phone', 'budgetMin']));
    expect((await mk(owner, { name: 'X', phone: '123' })).body.error.details[0].path).toBe('phone');
  });
  it('detects duplicates by any phone format and by email, and allows an explicit override', async () => {
    await mk(owner, { name: 'Dup Original', phone: '9811100001' });
    const dup = await mk(owner, { name: 'Dup Again', phone: '+91 98111-00001' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_lead');
    expect(dup.body.error.details[0].name).toBe('Dup Original');
    const byEmail = await mk(owner, { name: 'E1', email: 'same@example.com' });
    expect(byEmail.status).toBe(201);
    expect((await mk(owner, { name: 'E2', email: 'SAME@example.com' })).status).toBe(409);
    expect((await mk(owner, { name: 'E2', email: 'same@example.com', allowDuplicate: true })).status).toBe(201);
    const check = await ctx.http().post('/leads/check-duplicates').set(auth(owner.accessToken)).send({ phone: '09811100001' });
    expect(check.body).toHaveLength(1);
  });
  it('updates fields, records changed fields in history, and soft-deletes only with permission', async () => {
    const l = (await mk(owner, { name: 'Upd Lead', phone: '9822200001' })).body;
    const up = await ctx.http().patch(`/leads/${l.id}`).set(auth(owner.accessToken)).send({ location: 'Baner', budgetMax: 9_000_000 });
    expect(up.body).toMatchObject({ location: 'Baner', budgetMax: 9_000_000, score: 30, temperature: 'COLD' });
    const tl = await ctx.http().get(`/leads/${l.id}/activity`).set(auth(owner.accessToken));
    expect(tl.body.find((a: { type: string }) => a.type === 'updated').data.fields).toEqual(expect.arrayContaining(['location', 'budgetMax']));
    expect((await ctx.http().delete(`/leads/${l.id}`).set(auth(manager.accessToken))).status).toBe(403);
    expect((await ctx.http().delete(`/leads/${l.id}`).set(auth(owner.accessToken))).status).toBe(204);
    expect((await ctx.http().get(`/leads/${l.id}`).set(auth(owner.accessToken))).status).toBe(404);
  });
  it('validates custom fields against the industry pack definitions', async () => {
    expect((await mk(owner, { name: 'CF1', phone: '9833300001', customFields: { facing: 'North', loan_required: true } })).body.customFields).toEqual({ facing: 'North', loan_required: true });
    expect((await mk(owner, { name: 'CF2', phone: '9833300002', customFields: { facing: 'Up' } })).status).toBe(400);
    expect((await mk(owner, { name: 'CF3', phone: '9833300003', customFields: { nope: 1 } })).status).toBe(400);
  });
});

describe('listing, search, filters', () => {
  it('searches by name, partial phone and email; paginates with a total', async () => {
    for (let i = 0; i < 6; i++) await mk(owner, { name: `Searchable ${i}`, phone: `97000000${i}0`, location: i % 2 ? 'Pune' : 'Mumbai' });
    const byName = await ctx.http().get('/leads?q=searchable').set(auth(owner.accessToken));
    expect(byName.body.total).toBe(6);
    const page = await ctx.http().get('/leads?q=searchable&pageSize=4&page=2&sort=name&dir=asc').set(auth(owner.accessToken));
    expect(page.body.items).toHaveLength(2);
    expect(page.body.items[0].name).toBe('Searchable 4');
    const byPhone = await ctx.http().get('/leads?q=97000000').set(auth(owner.accessToken));
    expect(byPhone.body.total).toBe(6);
    expect((await ctx.http().get('/leads?q=%25').set(auth(owner.accessToken))).status).toBe(200); // wildcard chars are data, not syntax
    expect((await ctx.http().get('/leads?pageSize=1000').set(auth(owner.accessToken))).status).toBe(400);
  });
  it('filters by stage kind, assignee and temperature', async () => {
    const un = await ctx.http().get('/leads?assigned=unassigned').set(auth(owner.accessToken));
    expect(un.body.items.every((l: { assignedMembershipId: string | null }) => l.assignedMembershipId === null)).toBe(true);
    const open = await ctx.http().get('/leads?kind=OPEN&pageSize=100').set(auth(owner.accessToken));
    expect(open.body.items.every((l: { stage: { kind: string } }) => l.stage.kind === 'OPEN')).toBe(true);
  });
});

describe('row-level access: agents see only their leads; tenants never see each other', () => {
  let leadForAgent: string; let leadForAgent2: string;
  beforeAll(async () => {
    leadForAgent = (await mk(owner, { name: 'Belongs Agent1', phone: '9844400001', assignedMembershipId: memberIds[agent.email] })).body.id;
    leadForAgent2 = (await mk(owner, { name: 'Belongs Agent2', phone: '9844400002', assignedMembershipId: memberIds[agent2.email] })).body.id;
  });
  it('agent lists only own leads and gets 404 (not 403) for others', async () => {
    const list = await ctx.http().get('/leads?pageSize=100').set(auth(agent.accessToken));
    expect(list.body.items.map((l: { id: string }) => l.id)).toEqual([leadForAgent]);
    expect((await ctx.http().get(`/leads/${leadForAgent2}`).set(auth(agent.accessToken))).status).toBe(404);
    expect((await ctx.http().patch(`/leads/${leadForAgent2}`).set(auth(agent.accessToken)).send({ location: 'x' })).status).toBe(404);
    expect((await ctx.http().get(`/leads/${leadForAgent2}/notes`).set(auth(agent.accessToken))).status).toBe(404);
    expect((await ctx.http().post(`/leads/${leadForAgent2}/notes`).set(auth(agent.accessToken)).send({ body: 'hi' })).status).toBe(404);
  });
  it('agent can edit own lead but cannot reassign or merge', async () => {
    expect((await ctx.http().patch(`/leads/${leadForAgent}`).set(auth(agent.accessToken)).send({ location: 'Hinjewadi' })).status).toBe(200);
    expect((await ctx.http().patch(`/leads/${leadForAgent}`).set(auth(agent.accessToken)).send({ assignedMembershipId: memberIds[agent2.email] })).status).toBe(403);
    expect((await ctx.http().post(`/leads/${leadForAgent}/merge`).set(auth(agent.accessToken)).send({ sourceIds: [leadForAgent2] })).status).toBe(403);
  });
  it('an agent-created lead is assigned to that agent', async () => {
    const r = await mk(agent, { name: 'Agent Made', phone: '9844400003' });
    expect(r.body.assignedMembershipId).toBe(memberIds[agent.email]);
  });
  it('agents cannot export or import', async () => {
    expect((await ctx.http().get('/leads/export').set(auth(agent.accessToken))).status).toBe(403);
    expect((await ctx.http().post('/leads/import').set(auth(agent.accessToken)).send({ csv: 'name,phone\nA,9000000000', dryRun: true })).status).toBe(403);
  });
  it('another tenant cannot read, update, stage, merge or list these leads', async () => {
    expect((await ctx.http().get(`/leads/${leadForAgent}`).set(auth(otherOwner.accessToken))).status).toBe(404);
    expect((await ctx.http().patch(`/leads/${leadForAgent}`).set(auth(otherOwner.accessToken)).send({ name: 'pwned' })).status).toBe(404);
    expect((await ctx.http().delete(`/leads/${leadForAgent}`).set(auth(otherOwner.accessToken))).status).toBe(404);
    const mine = await mk(otherOwner, { name: 'Other Tenant Lead', phone: '9855500001' });
    expect((await ctx.http().post(`/leads/${mine.body.id}/merge`).set(auth(otherOwner.accessToken)).send({ sourceIds: [leadForAgent] })).status).toBe(404);
    const theirs = await ctx.http().get('/leads?pageSize=100').set(auth(otherOwner.accessToken));
    expect(theirs.body.total).toBe(1);
    // cross-tenant assignment and stage ids are rejected
    expect((await mk(owner, { name: 'X', phone: '9866600001', assignedMembershipId: (await ctx.http().get('/team/members').set(auth(otherOwner.accessToken))).body[0].id })).status).toBe(400);
    const lead = (await mk(owner, { name: 'Stage Probe', phone: '9866600002' })).body;
    const otherStages = await ctx.http().get('/pipeline/stages').set(auth(otherOwner.accessToken));
    expect((await ctx.http().post(`/leads/${lead.id}/stage`).set(auth(owner.accessToken)).send({ stageId: otherStages.body.stages[1].id })).status).toBe(404);
  });
});

describe('pipeline transitions', () => {
  it('walks a lead through stages, enforcing win and lose rules, and records history', async () => {
    const l = (await mk(owner, { name: 'Journey', phone: '9877700001' })).body;
    const move = (stageId: string, extra: object = {}) => ctx.http().post(`/leads/${l.id}/stage`).set(auth(owner.accessToken)).send({ stageId, ...extra });
    expect((await move(stages.won!)).status).toBe(422);
    expect((await move(stages.lost!)).body.error.code).toBe('lost_reason_required');
    expect((await move(stages.contacted!)).status).toBe(200);
    expect((await move(stages.contacted!)).status).toBe(400);
    expect((await move(stages.negotiation!)).body.stage.key).toBe('negotiation');
    expect((await move(stages.won!)).body.stage.key).toBe('won');
    // manager can reopen (lead:write:all); agent cannot
    expect((await ctx.http().post(`/leads/${l.id}/stage`).set(auth(manager.accessToken)).send({ stageId: stages.qualified })).status).toBe(200);
    const lost = await move(stages.lost!, { lostReasonId: reasons[0], lostNote: 'Bought elsewhere' });
    expect(lost.body).toMatchObject({ stage: { key: 'lost' }, lostReasonId: reasons[0] });
    const tl = await ctx.http().get(`/leads/${l.id}/activity`).set(auth(owner.accessToken));
    const moves = tl.body.filter((a: { type: string }) => a.type === 'stage_changed');
    expect(moves.length).toBeGreaterThanOrEqual(5);
  });
  it('an agent cannot reopen a closed lead', async () => {
    const l = (await mk(agent, { name: 'Closed By Agent', phone: '9877700002' })).body;
    for (const [id, extra] of [[stages.contacted, {}], [stages.negotiation, {}], [stages.won, {}]] as const) await ctx.http().post(`/leads/${l.id}/stage`).set(auth(agent.accessToken)).send({ stageId: id, ...extra });
    expect((await ctx.http().post(`/leads/${l.id}/stage`).set(auth(agent.accessToken)).send({ stageId: stages.new })).status).toBe(403);
  });
});

describe('bulk operations', () => {
  it('assigns many, reports per-lead failures for invalid stage moves, and tags', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await mk(owner, { name: `Bulk ${i}`, phone: `9888800${i}01` })).body.id);
    const assign = await ctx.http().post('/leads/bulk').set(auth(manager.accessToken)).send({ action: 'assign', ids, assignedMembershipId: memberIds[agent.email] });
    expect(assign.body).toEqual({ updated: 3, skipped: [] });
    // one lead is moved to Won first (not allowed from "new"): per-item failure, rest succeed
    const stage = await ctx.http().post('/leads/bulk').set(auth(manager.accessToken)).send({ action: 'stage', ids, stageId: stages.contacted });
    expect(stage.body.updated).toBe(3);
    const bad = await ctx.http().post('/leads/bulk').set(auth(manager.accessToken)).send({ action: 'stage', ids, stageId: stages.won });
    expect(bad.body.updated).toBe(0);
    expect(bad.body.skipped).toHaveLength(3);
    const tag = await ctx.http().post('/leads/bulk').set(auth(manager.accessToken)).send({ action: 'tag', ids, add: ['hot-campaign'], remove: [] });
    expect(tag.body.updated).toBe(3);
    expect((await ctx.http().get('/leads?q=Bulk').set(auth(owner.accessToken))).body.items[0].tags[0].name).toBe('hot-campaign');
    // agent cannot bulk-assign or bulk-delete; nobody can touch leads outside their scope
    expect((await ctx.http().post('/leads/bulk').set(auth(agent.accessToken)).send({ action: 'assign', ids, assignedMembershipId: null })).status).toBe(403);
    expect((await ctx.http().post('/leads/bulk').set(auth(manager.accessToken)).send({ action: 'delete', ids })).status).toBe(403);
    const foreign = await ctx.http().post('/leads/bulk').set(auth(otherOwner.accessToken)).send({ action: 'tag', ids, add: ['x'], remove: [] });
    expect(foreign.body).toMatchObject({ updated: 0 });
  });
  it('caps batch size', async () => {
    const ids = Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000000');
    expect((await ctx.http().post('/leads/bulk').set(auth(owner.accessToken)).send({ action: 'tag', ids, add: ['x'], remove: [] })).status).toBe(400);
  });
});

describe('notes, tags and merge', () => {
  it('adds notes with author, and keeps history of merged leads on the survivor', async () => {
    const target = (await mk(owner, { name: 'Survivor', phone: '9899900001' })).body;
    const dupe = (await mk(owner, { name: 'Duplicate', email: 'dupe@example.com', location: 'Kothrud', phone: '9899900002' })).body;
    await ctx.http().post(`/leads/${dupe.id}/notes`).set(auth(owner.accessToken)).send({ body: 'Called twice' });
    await ctx.http().put(`/leads/${dupe.id}/tags`).set(auth(owner.accessToken)).send({ names: ['vip'] });
    expect((await ctx.http().post(`/leads/${target.id}/notes`).set(auth(owner.accessToken)).send({ body: '  ' })).status).toBe(400);
    const merged = await ctx.http().post(`/leads/${target.id}/merge`).set(auth(manager.accessToken)).send({ sourceIds: [dupe.id] });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ name: 'Survivor', email: 'dupe@example.com', location: 'Kothrud' });
    expect(merged.body.tags.map((t: { name: string }) => t.name)).toContain('vip');
    expect((await ctx.http().get(`/leads/${dupe.id}`).set(auth(owner.accessToken))).status).toBe(404);
    const notes = await ctx.http().get(`/leads/${target.id}/notes`).set(auth(owner.accessToken));
    expect(notes.body[0]).toMatchObject({ body: 'Called twice' });
    const detail = await ctx.http().get(`/leads/${target.id}`).set(auth(owner.accessToken));
    expect(detail.body.mergedLeads[0].name).toBe('Duplicate');
    const audit = await ctx.http().get('/audit-logs?action=lead.merged').set(auth(owner.accessToken));
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect((await ctx.http().post(`/leads/${target.id}/merge`).set(auth(manager.accessToken)).send({ sourceIds: [target.id] })).status).toBe(400);
  });
});

describe('CSV import and export', () => {
  const csv = [
    'Name,Mobile,Email,Budget,Max Budget,City,Timeline,Tags,cf:facing',
    'Imp One,9911100001,imp1@example.com,₹80 L,1 Cr,Baner,Immediate,hot;site-visit,East',
    'Imp Two,+91 99111 00002,,85 L,,Wakad,3-6 months,,',
    '"Imp, Three",9911100003,,bad-amount,,,,,',
    'Imp Four,not-a-phone,,,,,,,',
    ',9911100005,,,,,,,',
    'Imp Dup,9911100001,,,,,,,',
    '=cmd|\' /C calc\'!A0,9911100006,,,,,,,',
  ].join('\r\n');
  it('dry run reports valid, invalid and duplicate rows without writing anything', async () => {
    const before = (await ctx.http().get('/leads?pageSize=1').set(auth(owner.accessToken))).body.total;
    const res = await ctx.http().post('/leads/import').set(auth(manager.accessToken)).send({ csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, totalRows: 7, created: 0 });
    expect(res.body.invalid.map((i: { row: number }) => i.row)).toEqual([4, 5, 6]);
    expect(res.body.duplicates).toEqual([{ row: 7, reason: 'in_file' }]);
    expect((await ctx.http().get('/leads?pageSize=1').set(auth(owner.accessToken))).body.total).toBe(before);
  });
  it('imports valid rows, skips duplicates, applies tags and custom fields, and is idempotent on re-run', async () => {
    const res = await ctx.http().post('/leads/import').set(auth(manager.accessToken)).send({ csv, dryRun: false, duplicateStrategy: 'skip' });
    expect(res.body).toMatchObject({ created: 3, skipped: 1 });
    const one = (await ctx.http().get('/leads?q=Imp One').set(auth(owner.accessToken))).body.items[0];
    expect(one).toMatchObject({ budgetMin: 8_000_000, budgetMax: 10_000_000, location: 'Baner', buyingTimeline: 'IMMEDIATE', source: { key: 'csv_import' } });
    expect(one.tags.map((t: { name: string }) => t.name).sort()).toEqual(['hot', 'site-visit']);
    expect(one.customFields).toEqual({ facing: 'East' });
    const again = await ctx.http().post('/leads/import').set(auth(manager.accessToken)).send({ csv, dryRun: false, duplicateStrategy: 'skip' });
    expect(again.body.created).toBe(0);
  });
  it('rejects files without a name column or with too many rows', async () => {
    expect((await ctx.http().post('/leads/import').set(auth(manager.accessToken)).send({ csv: 'phone\n9000000000', dryRun: true })).body.error.code).toBe('missing_name_column');
    const big = `name,phone\n${Array.from({ length: 5001 }, (_, i) => `L${i},9${String(i).padStart(9, '0')}`).join('\n')}`;
    expect((await ctx.http().post('/leads/import').set(auth(manager.accessToken)).send({ csv: big, dryRun: true })).body.error.code).toBe('too_many_rows');
  });
  it('exports with formula-injection protection and respects tenant scope', async () => {
    const res = await ctx.http().get('/leads/export?q=Imp').set(auth(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Imp One');
    expect(res.text).not.toContain('Searchable');
    const other = await ctx.http().get('/leads/export').set(auth(otherOwner.accessToken));
    expect(other.text).not.toContain('Imp One');
    await mk(owner, { name: '=SUM(1+1)', phone: '9922200001' });
    const inj = await ctx.http().get('/leads/export?q=SUM').set(auth(owner.accessToken));
    expect(inj.text).toContain("'=SUM(1+1)");
  });
});

describe('round-robin assignment', () => {
  it('distributes new leads evenly across agents once enabled, and survives concurrent creates', async () => {
    expect((await ctx.http().put('/tenant/assignment').set(auth(manager.accessToken)).send({ strategy: 'round_robin' })).status).toBe(403);
    expect((await ctx.http().put('/tenant/assignment').set(auth(owner.accessToken)).send({ strategy: 'round_robin' })).status).toBe(200);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => mk(owner, { name: `RR ${i}`, phone: `9933300${i}01` })));
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.body.assignedMembershipId] = (counts[r.body.assignedMembershipId] ?? 0) + 1;
    expect(Object.keys(counts).sort()).toEqual([memberIds[agent.email], memberIds[agent2.email]].sort());
    expect(Object.values(counts)).toEqual([3, 3]);
    await ctx.http().put('/tenant/assignment').set(auth(owner.accessToken)).send({ strategy: 'manual' });
  });
});
