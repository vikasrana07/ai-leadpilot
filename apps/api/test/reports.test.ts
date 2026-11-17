import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

/**
 * Reports are checked against a hand-built fixture. Range: 1-2 Oct 2026 (custom), workspace timezone Asia/Kolkata (UTC+5:30), so a lead created
 * at 06:30Z sits at 12:00 IST on its day. Everything below was worked out by hand from the rows inserted here, not read back from the code.
 */
let ctx: TestCtx; let owner: Account; let agent: Account; let other: Account;
const o = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
const q = (sql: string, p: unknown[] = []) => o.query(sql, p);
const RANGE = 'range=custom&from=2026-10-01T00:00:00.000Z&to=2026-10-02T00:00:00.000Z';
const get = (a: Account, path: string) => ctx.http().get(path).set(auth(a.accessToken));
const uid = () => crypto.randomUUID();
let M: { A: string; B: string };

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'repOwner'); other = await registerAccount(ctx, 'repOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'repAgent', 'agent');
  const members = (await get(owner, '/team/members')).body as { id: string; user: { email: string } }[];
  M = { A: members.find((m) => m.user.email === owner.email)?.id as string, B: members.find((m) => m.user.email === agent.email)?.id as string };
  const T = owner.tenantId;
  const stages = (await q(`SELECT id, kind::text AS kind, qualifies FROM pipeline_stages WHERE tenant_id = $1 ORDER BY position`, [T])).rows as { id: string; kind: string; qualifies: boolean }[];
  const open = stages.filter((s) => s.kind === 'OPEN'); const s0 = open[0]?.id as string; const Q = open.find((s) => s.qualifies && s.id !== s0)?.id as string;
  const WON = stages.find((s) => s.kind === 'WON')?.id as string; const LOST = stages.find((s) => s.kind === 'LOST')?.id as string;
  expect(Q).toBeTruthy(); expect(WON).toBeTruthy(); expect(LOST).toBeTruthy();
  const src = async (key: string, name: string) => { const id = uid(); await q(`INSERT INTO lead_sources (id, tenant_id, key, name) VALUES ($1,$2,$3,$4)`, [id, T, key, name]); return id; };
  const web = await src('rep_web', 'Website'); const fb = await src('rep_fb', 'Facebook'); const evil = await src('rep_evil', `=HYPERLINK("http://evil.example","x")`);
  const lead = async (n: string, created: string, source: string, stage: string, assigned: string | null) => { const id = uid(); await q(`INSERT INTO leads (id, tenant_id, name, source_id, stage_id, assigned_membership_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`, [id, T, n, source, stage, assigned, created]); return id; };
  const tr = (l: string, from: string | null, to: string, at: string) => q(`INSERT INTO stage_transitions (id, tenant_id, lead_id, from_stage_id, to_stage_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [uid(), T, l, from, to, at]);
  const L1 = await lead('L1', '2026-10-01T06:30:00Z', web, s0, M.A);
  const L2 = await lead('L2', '2026-10-01T06:30:00Z', web, WON, M.A); await tr(L2, s0, Q, '2026-10-01T07:00:00Z'); await tr(L2, Q, WON, '2026-10-01T09:00:00Z');
  const L3 = await lead('L3', '2026-10-01T06:30:00Z', fb, Q, M.B); await tr(L3, s0, Q, '2026-10-01T08:00:00Z');
  const L4 = await lead('L4', '2026-10-02T06:30:00Z', fb, LOST, M.B); await tr(L4, s0, LOST, '2026-10-02T08:00:00Z');
  await lead('L5', '2026-10-02T06:30:00Z', evil, s0, null);
  await lead('L6', '2026-09-30T06:30:00Z', web, s0, M.A); // previous period (29-30 Sep)
  await lead('L7', '2026-10-03T06:30:00Z', web, s0, M.A); // after the range: must not count
  await q(`UPDATE leads SET deleted_at = now() WHERE id = $1`, [(await lead('Deleted', '2026-10-01T07:00:00Z', web, s0, M.A))]); // deleted leads never count

  // appointments (by start time)
  const ap = async (status: string, lead_: string, member: string, at: string, source: string) => q(`INSERT INTO appointments (id, tenant_id, lead_id, membership_id, title, starts_at, ends_at, status, source, updated_at) VALUES ($1,$2,$3,$4,'Visit',$5,$5::timestamptz + interval '30 minutes',$6::"AppointmentStatus",$7,now())`, [uid(), T, lead_, member, at, status, source]);
  await ap('COMPLETED', L1, M.A, '2026-10-01T05:00:00Z', 'manual'); await ap('COMPLETED', L2, M.A, '2026-10-02T05:00:00Z', 'manual');
  await ap('NO_SHOW', L3, M.B, '2026-10-01T06:00:00Z', 'manual'); await ap('CANCELLED', L4, M.B, '2026-10-02T06:00:00Z', 'manual'); await ap('CONFIRMED', L1, M.A, '2026-10-02T08:00:00Z', 'ai');
  await ap('COMPLETED', L1, M.A, '2026-10-05T05:00:00Z', 'manual'); // outside the range

  // conversations and first responses
  const ch = uid(); await q(`INSERT INTO channels (id, tenant_id, type, name, updated_at) VALUES ($1,$2,'WEB_WIDGET','Rep widget',now())`, [ch, T]);
  const conv = async (l: string, at: string) => { const id = uid(); await q(`INSERT INTO conversations (id, tenant_id, channel_id, lead_id, external_thread_id, created_at, last_message_at) VALUES ($1,$2,$3,$4,$5,$6,$6)`, [id, T, ch, l, `t-${id}`, at]); return id; };
  const msg = async (c: string, dir: 'INBOUND' | 'OUTBOUND', who: string, at: string) => { const id = uid(); await q(`INSERT INTO messages (id, tenant_id, conversation_id, channel_id, direction, "senderType", type, body, status, created_at) VALUES ($1,$2,$3,$4,$5::"MessageDirection",$6::"SenderType",'TEXT','x','DELIVERED',$7)`, [id, T, c, ch, dir, who, at]); return id; };
  const C1 = await conv(L1, '2026-10-01T10:00:00Z'); await msg(C1, 'INBOUND', 'CUSTOMER', '2026-10-01T10:00:00Z'); await msg(C1, 'OUTBOUND', 'AI', '2026-10-01T10:02:00Z');
  const C2 = await conv(L2, '2026-10-01T11:00:00Z'); await msg(C2, 'INBOUND', 'CUSTOMER', '2026-10-01T11:00:00Z'); await msg(C2, 'OUTBOUND', 'AGENT', '2026-10-01T11:20:00Z');
  const C3 = await conv(L3, '2026-10-02T09:00:00Z'); const in3 = await msg(C3, 'INBOUND', 'CUSTOMER', '2026-10-02T09:00:00Z');
  const C4 = await conv(L4, '2026-10-02T12:00:00Z'); await msg(C4, 'INBOUND', 'CUSTOMER', '2026-10-02T12:00:00Z'); await msg(C4, 'OUTBOUND', 'AI', '2026-10-02T12:01:00Z'); await msg(C4, 'OUTBOUND', 'AGENT', '2026-10-02T12:30:00Z');
  await q(`INSERT INTO sla_breaches (id, tenant_id, conversation_id, inbound_message_id, breached_at) VALUES ($1,$2,$3,$4,'2026-10-02T09:20:00Z')`, [uid(), T, C3, in3]);

  // AI runs
  const run = (c: string, status: string, i: number, out: number, lat: number | null, trace: object) => q(`INSERT INTO ai_runs (id, tenant_id, conversation_id, status, prompt_version, input_tokens, output_tokens, latency_ms, trace, created_at) VALUES ($1,$2,$3,$4::"AiRunStatus",'v1',$5,$6,$7,$8,'2026-10-01T10:01:00Z')`, [uid(), T, c, status, i, out, lat, JSON.stringify(trace)]);
  await run(C1, 'COMPLETED', 100, 50, 1000, { tools: [], outcome: 'replied' }); await run(C1, 'COMPLETED', 200, 100, 3000, { tools: [{ name: 'handover_to_human', ok: true }], outcome: 'handover' });
  await run(C2, 'SKIPPED', 0, 0, null, { tools: [], outcome: 'token_cap_exceeded', guard: { violations: ['unsupported_time:15:00'] } }); await run(C3, 'FAILED', 0, 0, null, { tools: [] });

  // automations
  const au = uid(); await q(`INSERT INTO automations (id, tenant_id, name, enabled, trigger, actions, updated_at) VALUES ($1,$2,'Welcome',true,'{"type":"lead.created"}','[]',now())`, [au, T]);
  const ar = (status: string, err: string | null) => q(`INSERT INTO automation_runs (id, tenant_id, automation_id, event_id, event_type, status, error, created_at) VALUES ($1,$2,$3,$4,'lead.created',$5::"RunStatus",$6,'2026-10-01T09:00:00Z')`, [uid(), T, au, uid(), status, err]);
  for (let i = 0; i < 3; i++) await ar('SUCCEEDED', null); await ar('FAILED', 'boom'); await ar('SKIPPED', null); await ar('DRY_RUN', null);
});
afterAll(async () => { await o.end(); await ctx.close(); await cleanup(); });

describe('lead acquisition', () => {
  it('counts leads created in the range (not deleted, not outside), by source and by day, with period-over-period change', async () => {
    const r = (await get(owner, `/reports/acquisition?${RANGE}`)).body;
    expect(r.range.timezone).toBe('Asia/Kolkata');
    expect(r.summary).toMatchObject({ totalLeads: 5, previousPeriod: 1, changePct: 400, won: 1 });
    const bySource = r.tables[0].rows as { source: string; leads: number; won: number; qualified: number; conversionPct: number }[];
    expect(bySource.find((s) => s.source === 'Website')).toMatchObject({ leads: 2, won: 1, qualified: 1, conversionPct: 50 });
    expect(bySource.find((s) => s.source === 'Facebook')).toMatchObject({ leads: 2, won: 0, qualified: 1, conversionPct: 0 }); // L3 sits in a qualifying stage
    expect(bySource.find((s) => s.source.startsWith('=HYPERLINK'))).toMatchObject({ leads: 1 });
    expect(r.series.trend).toEqual([{ date: '2026-10-01', leads: 3 }, { date: '2026-10-02', leads: 2 }]);
  });
});

describe('funnel and stage conversion', () => {
  it('counts how many of the period\'s leads reached each stage, from transitions and current stage', async () => {
    const r = (await get(owner, `/reports/funnel?${RANGE}`)).body;
    expect(r.summary).toMatchObject({ cohort: 5, won: 1, lost: 1, winRatePct: 20, lossRatePct: 20 });
    const f = r.series.funnel as { stage: string; kind: string; reached: number; currentlyHere: number; stepConversionPct: number | null }[];
    expect(f[0]).toMatchObject({ reached: 5, stepConversionPct: null });
    const q2 = f.find((s) => s.reached === 2); expect(q2).toMatchObject({ currentlyHere: 1 }); // L2 passed through, L3 is there
    expect(f.at(-1)).toMatchObject({ kind: 'WON', reached: 1 });
    expect(f.some((s) => s.kind === 'LOST')).toBe(false); // lost is reported separately, not as a funnel step
  });
});

describe('agent performance', () => {
  it('attributes leads, wins, visits and conversations to the right people (managers only)', async () => {
    const r = (await get(owner, `/reports/agents?${RANGE}`)).body;
    const rows = r.tables[0].rows as Record<string, number | string>[];
    const a = rows.find((x) => x.agent === 'User repOwner'); const b = rows.find((x) => x.agent === 'User repAgent'); const un = rows.find((x) => x.agent === 'Unassigned');
    expect(a).toMatchObject({ leads: 2, openNow: 3 /* L1, L6 and L7: open now, whatever their created date; the deleted lead is excluded */, won: 1, conversionPct: 50, appointmentsCompleted: 2, noShows: 0 });
    expect(b).toMatchObject({ leads: 2, openNow: 1, won: 0, appointmentsCompleted: 0, noShows: 1 });
    expect(un).toMatchObject({ leads: 1, openNow: 1 });
    expect((await get(agent, `/reports/agents?${RANGE}`)).status).toBe(403);
  });
});

describe('response time and SLA', () => {
  it('measures first response per conversation, by responder, against the SLA target', async () => {
    const r = (await get(owner, `/reports/response?${RANGE}`)).body;
    expect(r.summary).toMatchObject({ conversations: 4, answered: 3, unanswered: 1, medianMinutes: 2, p90Minutes: 20, targetMinutes: 15, slaBreaches: 1 });
    expect(r.summary.withinTargetPct).toBeCloseTo(66.7, 1);
    const who = r.series.byResponder as { responder: string; conversations: number; medianMinutes: number; withinTargetPct: number }[];
    expect(who.find((w) => w.responder === 'AI assistant')).toMatchObject({ conversations: 2, medianMinutes: 2, withinTargetPct: 100 });
    expect(who.find((w) => w.responder === 'Team member')).toMatchObject({ conversations: 1, medianMinutes: 20, withinTargetPct: 0 });
  });
});

describe('appointment outcomes', () => {
  it('counts by status, show rate, source and day (by start time, range only)', async () => {
    const r = (await get(owner, `/reports/appointments?${RANGE}`)).body;
    expect(r.summary).toMatchObject({ total: 5, completed: 2, noShow: 1, cancelled: 1, upcomingOrPending: 1, cancellationRatePct: 20 });
    expect(r.summary.showRatePct).toBeCloseTo(66.7, 1);
    const src = r.tables.find((t: { name: string }) => t.name === 'by_source').rows as { source: string; appointments: number }[];
    expect(src.find((s) => s.source === 'manual')?.appointments).toBe(4); expect(src.find((s) => s.source === 'ai')?.appointments).toBe(1);
    expect(r.series.trend).toEqual([{ date: '2026-10-01', booked: 2, completed: 1 }, { date: '2026-10-02', booked: 3, completed: 1 }]);
  });
});

describe('AI conversation stats', () => {
  it('summarises turns, handover rate, tokens and latency', async () => {
    const r = (await get(owner, `/reports/ai?${RANGE}`)).body;
    expect(r.summary).toMatchObject({ aiTurns: 4, conversationsHandled: 3, handovers: 1, completed: 2, skipped: 1, failed: 1, inputTokens: 300, outputTokens: 150, avgLatencyMs: 2000, p95LatencyMs: 2900, repliesBlockedByGuards: 1 });
    expect(r.summary.handoverRatePct).toBeCloseTo(33.3, 1);
    expect((r.tables.find((t: { name: string }) => t.name === 'tools').rows as { tool: string; calls: number }[])[0]).toEqual({ tool: 'handover_to_human', calls: 1 });
  });
});

describe('automation summary', () => {
  it('counts real runs by outcome, excluding dry runs', async () => {
    const r = (await get(owner, `/reports/automations?${RANGE}`)).body;
    expect(r.summary).toMatchObject({ runs: 5, succeeded: 3, failed: 1, skipped: 1, successRatePct: 75, activeAutomations: 1 });
    expect((r.tables.find((t: { name: string }) => t.name === 'failures').rows as { error: string }[])[0]?.error).toBe('boom');
  });
});

describe('scoping, filters, export and isolation', () => {
  it('shows an agent only reports about their own leads, and another workspace sees none of this data', async () => {
    const a = (await get(agent, `/reports/acquisition?${RANGE}`)).body;
    expect(a.scope).toBe('own'); expect(a.summary.totalLeads).toBe(2); // L3 and L4 are assigned to them
    expect((await get(agent, `/reports/funnel?${RANGE}`)).body.summary.cohort).toBe(2);
    for (const k of ['ai', 'automations', 'agents']) expect((await get(agent, `/reports/${k}?${RANGE}`)).status, k).toBe(403);
    const x = (await get(other, `/reports/acquisition?${RANGE}`)).body;
    expect(x.summary.totalLeads).toBe(0); expect((await get(other, `/reports/ai?${RANGE}`)).body.summary.aiTurns).toBe(0);
  });
  it('supports the preset ranges and rejects bad input', async () => {
    for (const range of ['today', 'yesterday', '7d', '30d', 'month']) expect((await get(owner, `/reports/acquisition?range=${range}`)).status, range).toBe(200);
    expect((await get(owner, '/reports/acquisition?range=custom')).status).toBe(400);
    expect((await get(owner, '/reports/acquisition?range=custom&from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z')).status).toBe(400); // over 13 months
    expect((await get(owner, '/reports/nope')).status).toBe(400);
  });
  it('exports CSV with formula injection neutralised, audited, and only on plans with CSV export', async () => {
    const r = await get(owner, `/reports/acquisition/export?${RANGE}&table=by_source`);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/text\/csv/); expect(r.headers['content-disposition']).toContain('leadpilot-acquisition-by_source.csv');
    const text = r.text.replace(/^\uFEFF/, '');
    expect(text.split('\r\n')[0]).toBe('Source,Leads,Qualified,Won,Conversion %');
    expect(text).toContain("\"'=HYPERLINK(");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect((await q(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id = $1 AND action = 'report.exported'`, [owner.tenantId])).rows[0].n).toBe(1);
    await q(`INSERT INTO subscriptions (id, tenant_id, plan_key, status, provider, updated_at) VALUES (gen_random_uuid(), $1, 'starter', 'ACTIVE', 'manual', now())`, [owner.tenantId]);
    try { expect((await get(owner, `/reports/acquisition/export?${RANGE}`)).status).toBe(402); expect((await get(owner, `/reports/acquisition?${RANGE}`)).status).toBe(200); }
    finally { await q(`DELETE FROM subscriptions WHERE tenant_id = $1`, [owner.tenantId]); }
  });
});

describe('industry wording', () => {
  const titles = async (a: Account) => {
    const r = await get(a, `/reports/acquisition?${RANGE}`);
    expect(r.status).toBe(200);
    const t = (r.body as { tables: { name: string; title: string; columns: { key: string; label: string }[] }[] }).tables.find((x) => x.name === 'by_source');
    return { title: t?.title, labels: t?.columns.map((c) => c.label), keys: t?.columns.map((c) => c.key) };
  };
  it('real estate keeps "Leads" and the field keys never change', async () => {
    expect(await titles(owner)).toEqual({ title: 'Leads by source', labels: ['Source', 'Leads', 'Qualified', 'Won', 'Conversion %'], keys: ['source', 'leads', 'qualified', 'won', 'conversionPct'] });
  });
  it('other industries get their own nouns in table titles, column labels and the CSV header; keys and data are untouched', async () => {
    const co = await registerAccount(ctx, 'repCoach', 'coaching');
    const hs = await registerAccount(ctx, 'repHome', 'home_services');
    const t = await titles(co);
    expect(t.title).toBe('Enquiries by source');
    expect(t.labels).toContain('Enquiries');
    expect(t.keys).toEqual(['source', 'leads', 'qualified', 'won', 'conversionPct']); // contract unchanged
    expect((await titles(hs)).title).toBe('Customers by source');
    const agents = (await get(co, `/reports/agents?${RANGE}`)).body as { tables: { columns: { label: string }[] }[] };
    expect(agents.tables[0]?.columns.map((c) => c.label)).toContain('Demo classes completed'); // "Visits completed" follows the appointment noun
    const csv = await get(co, `/reports/acquisition/export?${RANGE}&table=by_source`);
    expect(csv.status).toBe(200);
    expect(String(csv.text).replace(/^\uFEFF/, '').split('\n')[0]).toContain('Enquiries');
    expect(String(csv.text)).not.toContain('Leads');
  });
});
