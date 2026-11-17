import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@leadpilot/database';
import { applyTerms, packForIndustry, packTerms } from '@leadpilot/shared-types';
import type { ReportKey, ReportQuery } from '@leadpilot/validation';
import { addDays, resolveRange, type Range } from '../analytics/date-range.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { DbService } from '../db/db.module.js';
import { readSla } from '../ops/scanners.service.js';

type Row = Record<string, string | number | null>;
export interface ReportTable { name: string; title: string; columns: { key: string; label: string }[]; rows: Row[] }
export interface ReportResult { report: ReportKey; range: { label: string; from: string; to: string; timezone: string }; scope: 'all' | 'own'; summary: Record<string, number | string | null>; series: Record<string, unknown[]>; tables: ReportTable[] }

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const round1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);
const num = (v: unknown) => Number(v ?? 0);

/** Reports are computed live from tenant-scoped queries (RLS plus explicit tenant filters); nothing is pre-aggregated or sample data. */
@Injectable()
export class ReportsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private scopeOf(ctx: TenantRequestContext, key: ReportKey): 'all' | 'own' {
    if (ctx.permissions.has('analytics:read:all') || ctx.permissions.has('analytics:read:team')) return 'all';
    if (!ctx.permissions.has('analytics:read:own')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot view reports' });
    // People-comparison and system reports are for managers; an agent only sees reports about their own work.
    if (key === 'agents' || key === 'ai' || key === 'automations') throw new ForbiddenException({ code: 'forbidden', message: 'This report is available to managers and owners' });
    return 'own';
  }

  async run(ctx: TenantRequestContext, key: ReportKey, q: ReportQuery): Promise<ReportResult> {
    const scope = this.scopeOf(ctx, key);
    if (q.range === 'custom' && (!q.from || !q.to)) throw new BadRequestException({ code: 'validation_error', message: 'Custom ranges need a start and end date' });
    return this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true, settings: true, industryPackId: true } });
      const range = resolveRange(q, t.timezone);
      if (range.to.getTime() - range.from.getTime() > 400 * 86_400_000) throw new BadRequestException({ code: 'range_too_large', message: 'Choose a range of up to 13 months' });
      const env: Env = { tx, ctx, tz: t.timezone, range, own: scope === 'own', sla: readSla(t.settings).firstResponseMinutes };
      const body = await this[key](env);
      // Table titles and column labels are our own fixed copy: word them for the workspace's industry (Enquiries by source...). The CSV export
      // uses the same result, so its headers match the screen. Field keys and row data are untouched; real estate output is identical.
      const terms = packTerms(packForIndustry(t.industryPackId));
      const tables = body.tables.map((tb) => ({ ...tb, title: applyTerms(tb.title, terms), columns: tb.columns.map((c) => ({ ...c, label: applyTerms(c.label, terms) })) }));
      return { report: key, range: { label: range.label, from: range.from.toISOString(), to: range.to.toISOString(), timezone: t.timezone }, scope, ...body, tables };
    });
  }

  private fill(env: Env, byDay: Map<string, Row>, make: (d: string, r: Row | undefined) => Row): Row[] {
    const out: Row[] = [];
    for (let t0 = env.range.from; t0 < env.range.to && out.length <= 400; t0 = addDays(t0, 1, env.tz)) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: env.tz }).format(new Date(t0.getTime() + 3 * 3600_000));
      out.push(make(d, byDay.get(d)));
    }
    return out;
  }

  // ------------------------------------------------------------------ 1. lead acquisition
  private async acquisition(e: Env): Promise<Body> {
    const own = e.own ? Prisma.sql`AND l.assigned_membership_id = ${e.ctx.membershipId}::uuid` : Prisma.empty;
    const span = e.range.to.getTime() - e.range.from.getTime();
    const prevFrom = new Date(e.range.from.getTime() - span);
    const [cur] = await e.tx.$queryRaw<{ n: number; prev: number }[]>`
      SELECT count(*) FILTER (WHERE l.created_at >= ${e.range.from} AND l.created_at < ${e.range.to})::int AS n, count(*) FILTER (WHERE l.created_at >= ${prevFrom} AND l.created_at < ${e.range.from})::int AS prev
      FROM leads l WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.created_at >= ${prevFrom} AND l.created_at < ${e.range.to} ${own}`;
    const days = await e.tx.$queryRaw<{ d: string; n: number }[]>`
      SELECT to_char((l.created_at AT TIME ZONE ${e.tz})::date, 'YYYY-MM-DD') AS d, count(*)::int AS n FROM leads l
      WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.created_at >= ${e.range.from} AND l.created_at < ${e.range.to} ${own} GROUP BY 1`;
    const sources = await e.tx.$queryRaw<{ name: string; leads: number; qualified: number; won: number }[]>`
      SELECT COALESCE(s.name, 'Unknown') AS name, count(*)::int AS leads, count(*) FILTER (WHERE st.qualifies OR st.kind = 'WON')::int AS qualified, count(*) FILTER (WHERE st.kind = 'WON')::int AS won
      FROM leads l JOIN pipeline_stages st ON st.id = l.stage_id LEFT JOIN lead_sources s ON s.id = l.source_id
      WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.created_at >= ${e.range.from} AND l.created_at < ${e.range.to} ${own} GROUP BY 1 ORDER BY leads DESC, name`;
    const temps = await e.tx.$queryRaw<{ t: string; n: number }[]>`
      SELECT l.temperature::text AS t, count(*)::int AS n FROM leads l WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.created_at >= ${e.range.from} AND l.created_at < ${e.range.to} ${own} GROUP BY 1`;
    const byDay = new Map<string, Row>(days.map((r) => [r.d, { leads: r.n }]));
    const trend = this.fill(e, byDay, (d, r) => ({ date: d, leads: num(r?.leads) }));
    const total = cur?.n ?? 0;
    return {
      summary: { totalLeads: total, previousPeriod: cur?.prev ?? 0, changePct: cur && cur.prev > 0 ? round1(((total - cur.prev) / cur.prev) * 100) : null, qualified: sources.reduce((a, s) => a + s.qualified, 0), won: sources.reduce((a, s) => a + s.won, 0), conversionPct: pct(sources.reduce((a, s) => a + s.won, 0), total) },
      series: { trend, temperature: temps.map((t0) => ({ temperature: t0.t, leads: t0.n })) },
      tables: [{ name: 'by_source', title: 'Leads by source', columns: [{ key: 'source', label: 'Source' }, { key: 'leads', label: 'Leads' }, { key: 'qualified', label: 'Qualified' }, { key: 'won', label: 'Won' }, { key: 'conversionPct', label: 'Conversion %' }],
        rows: sources.map((s) => ({ source: s.name, leads: s.leads, qualified: s.qualified, won: s.won, conversionPct: pct(s.won, s.leads) })) },
      { name: 'by_day', title: 'Leads per day', columns: [{ key: 'date', label: 'Date' }, { key: 'leads', label: 'Leads' }], rows: trend }],
    };
  }

  // ------------------------------------------------------------------ 2. funnel and stage conversion
  private async funnel(e: Env): Promise<Body> {
    const own = e.own ? Prisma.sql`AND l.assigned_membership_id = ${e.ctx.membershipId}::uuid` : Prisma.empty;
    const rows = await e.tx.$queryRaw<{ id: string; name: string; kind: string; position: number; reached: number; current: number }[]>`
      WITH cohort AS MATERIALIZED (SELECT l.id, l.stage_id FROM leads l WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.created_at >= ${e.range.from} AND l.created_at < ${e.range.to} ${own}),
      -- every (lead, stage) a cohort lead has been in: where it is now plus every stage it was moved into (set-based: one pass, no per-lead lookups)
      pairs AS MATERIALIZED (SELECT c.id AS lead_id, c.stage_id FROM cohort c UNION SELECT t.lead_id, t.to_stage_id FROM stage_transitions t JOIN cohort c ON c.id = t.lead_id WHERE t.tenant_id = ${e.ctx.tenantId}::uuid),
      reached AS (SELECT stage_id, count(*)::int AS n FROM pairs GROUP BY 1),
      here AS (SELECT stage_id, count(*)::int AS n FROM cohort GROUP BY 1),
      first_stage AS (SELECT id FROM pipeline_stages WHERE tenant_id = ${e.ctx.tenantId}::uuid AND kind = 'OPEN' ORDER BY position LIMIT 1)
      SELECT s.id, s.name, s.kind::text AS kind, s.position,
        CASE WHEN s.id = (SELECT id FROM first_stage) THEN (SELECT count(*) FROM cohort)::int ELSE COALESCE(r.n, 0) END AS reached,
        COALESCE(h.n, 0) AS current
      FROM pipeline_stages s LEFT JOIN reached r ON r.stage_id = s.id LEFT JOIN here h ON h.stage_id = s.id WHERE s.tenant_id = ${e.ctx.tenantId}::uuid ORDER BY s.position`;
    const chain = rows.filter((r) => r.kind !== 'LOST');
    const cohort = chain[0]?.reached ?? 0;
    const funnel = chain.map((r, i) => ({ stage: r.name, kind: r.kind, reached: r.reached, currentlyHere: r.current, stepConversionPct: i === 0 ? null : pct(r.reached, (chain[i - 1] as typeof r).reached), ofCohortPct: pct(r.reached, cohort) }));
    const lost = rows.filter((r) => r.kind === 'LOST').reduce((a, r) => a + r.current, 0);
    const won = rows.filter((r) => r.kind === 'WON').reduce((a, r) => a + r.current, 0);
    return {
      summary: { cohort, won, lost, winRatePct: pct(won, cohort), lossRatePct: pct(lost, cohort) },
      series: { funnel },
      tables: [{ name: 'funnel', title: 'Funnel by stage (leads created in the period)', columns: [{ key: 'stage', label: 'Stage' }, { key: 'reached', label: 'Reached' }, { key: 'currentlyHere', label: 'Currently here' }, { key: 'stepConversionPct', label: 'Step conversion %' }, { key: 'ofCohortPct', label: '% of all leads' }], rows: funnel }],
    };
  }

  // ------------------------------------------------------------------ 3. agent performance (managers)
  private async agents(e: Env): Promise<Body> {
    const rows = await e.tx.$queryRaw<{ id: string | null; name: string; leads: number; open_now: number; won: number; appts_done: number; no_shows: number; handled: number }[]>`
      WITH people AS (
        SELECT m.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${e.ctx.tenantId}::uuid AND m.status = 'ACTIVE'
        UNION ALL SELECT NULL::uuid, 'Unassigned')
      SELECT p.id, p.name,
        (SELECT count(*) FROM leads l WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.assigned_membership_id IS NOT DISTINCT FROM p.id AND l.created_at >= ${e.range.from} AND l.created_at < ${e.range.to})::int AS leads,
        (SELECT count(*) FROM leads l JOIN pipeline_stages st ON st.id = l.stage_id WHERE l.tenant_id = ${e.ctx.tenantId}::uuid AND l.deleted_at IS NULL AND l.assigned_membership_id IS NOT DISTINCT FROM p.id AND st.kind = 'OPEN')::int AS open_now,
        (SELECT count(DISTINCT l.id) FROM stage_transitions t JOIN pipeline_stages st ON st.id = t.to_stage_id JOIN leads l ON l.id = t.lead_id
           WHERE t.tenant_id = ${e.ctx.tenantId}::uuid AND st.kind = 'WON' AND t.created_at >= ${e.range.from} AND t.created_at < ${e.range.to} AND l.assigned_membership_id IS NOT DISTINCT FROM p.id)::int AS won,
        (SELECT count(*) FROM appointments a WHERE a.tenant_id = ${e.ctx.tenantId}::uuid AND a.membership_id = p.id AND a.status = 'COMPLETED' AND a.starts_at >= ${e.range.from} AND a.starts_at < ${e.range.to})::int AS appts_done,
        (SELECT count(*) FROM appointments a WHERE a.tenant_id = ${e.ctx.tenantId}::uuid AND a.membership_id = p.id AND a.status = 'NO_SHOW' AND a.starts_at >= ${e.range.from} AND a.starts_at < ${e.range.to})::int AS no_shows,
        (SELECT count(DISTINCT m."conversation_id") FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.tenant_id = ${e.ctx.tenantId}::uuid AND m."senderType" = 'AGENT' AND c.assigned_membership_id = p.id AND m.created_at >= ${e.range.from} AND m.created_at < ${e.range.to})::int AS handled
      FROM people p ORDER BY leads DESC, p.name`;
    const table = rows.map((r) => ({ agent: r.name, leads: r.leads, openNow: r.open_now, won: r.won, conversionPct: pct(r.won, r.leads), appointmentsCompleted: r.appts_done, noShows: r.no_shows, conversationsHandled: r.handled }));
    return {
      summary: { agents: rows.filter((r) => r.id !== null).length, leads: rows.reduce((a, r) => a + r.leads, 0), won: rows.reduce((a, r) => a + r.won, 0) },
      series: { agents: table.filter((r) => r.agent !== 'Unassigned').map((r) => ({ agent: r.agent, leads: r.leads, won: r.won })) },
      tables: [{ name: 'agents', title: 'Agent performance', columns: [{ key: 'agent', label: 'Agent' }, { key: 'leads', label: 'Leads in period' }, { key: 'openNow', label: 'Open now' }, { key: 'won', label: 'Won' }, { key: 'conversionPct', label: 'Conversion %' }, { key: 'appointmentsCompleted', label: 'Visits completed' }, { key: 'noShows', label: 'No-shows' }, { key: 'conversationsHandled', label: 'Conversations handled' }], rows: table }],
    };
  }

  // ------------------------------------------------------------------ 4. response time and SLA
  private async response(e: Env): Promise<Body> {
    const own = e.own ? Prisma.sql`AND c.assigned_membership_id = ${e.ctx.membershipId}::uuid` : Prisma.empty;
    const ownB = e.own ? Prisma.sql`AND c.assigned_membership_id = ${e.ctx.membershipId}::uuid` : Prisma.empty;
    const rows = await e.tx.$queryRaw<{ d: string; first_in: Date; mins: number | null; who: string | null }[]>`
      WITH conv AS (SELECT c.id FROM conversations c WHERE c.tenant_id = ${e.ctx.tenantId}::uuid AND c.created_at >= ${e.range.from} AND c.created_at < ${e.range.to} ${own}),
      fi AS (SELECT m.conversation_id, min(m.created_at) AS first_in FROM messages m JOIN conv ON conv.id = m.conversation_id WHERE m.tenant_id = ${e.ctx.tenantId}::uuid AND m.direction = 'INBOUND' GROUP BY 1)
      SELECT to_char((fi.first_in AT TIME ZONE ${e.tz})::date, 'YYYY-MM-DD') AS d, fi.first_in,
        EXTRACT(EPOCH FROM (r.created_at - fi.first_in)) / 60.0 AS mins, r."senderType"::text AS who
      FROM fi LEFT JOIN LATERAL (SELECT m.created_at, m."senderType" FROM messages m WHERE m.tenant_id = ${e.ctx.tenantId}::uuid AND m.conversation_id = fi.conversation_id AND m.direction = 'OUTBOUND' AND m."senderType" IN ('AGENT', 'AI') AND m.created_at >= fi.first_in ORDER BY m.created_at LIMIT 1) r ON true`;
    const answered = rows.filter((r) => r.mins !== null).map((r) => ({ ...r, mins: Number(r.mins) }));
    const sorted = answered.map((r) => r.mins).sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number : null);
    const within = answered.filter((r) => r.mins <= e.sla).length;
    const breaches = await e.tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM sla_breaches b JOIN conversations c ON c.id = b.conversation_id WHERE b.tenant_id = ${e.ctx.tenantId}::uuid AND b.breached_at >= ${e.range.from} AND b.breached_at < ${e.range.to} ${ownB}`;
    const byWho = ['AI', 'AGENT'].map((w) => { const xs = answered.filter((r) => r.who === w).map((r) => r.mins).sort((a, b) => a - b); return { responder: w === 'AI' ? 'AI assistant' : 'Team member', conversations: xs.length, medianMinutes: xs.length ? round1(xs[Math.floor(xs.length / 2)] as number) : null, withinTargetPct: pct(xs.filter((m) => m <= e.sla).length, xs.length) }; });
    const dayMap = new Map<string, number[]>(); for (const r of answered) dayMap.set(r.d, [...(dayMap.get(r.d) ?? []), r.mins]);
    const trend = this.fill(e, new Map(), (d) => { const xs = (dayMap.get(d) ?? []).sort((a, b) => a - b); return { date: d, conversations: xs.length, medianMinutes: xs.length ? round1(xs[Math.floor(xs.length / 2)] as number) : null }; });
    return {
      summary: { conversations: rows.length, answered: answered.length, unanswered: rows.length - answered.length, medianMinutes: round1(q(0.5)), p90Minutes: round1(q(0.9)), targetMinutes: e.sla, withinTargetPct: pct(within, answered.length), slaBreaches: breaches[0]?.n ?? 0 },
      series: { trend, byResponder: byWho },
      tables: [{ name: 'by_responder', title: 'First response by responder', columns: [{ key: 'responder', label: 'Responder' }, { key: 'conversations', label: 'Conversations' }, { key: 'medianMinutes', label: 'Median minutes' }, { key: 'withinTargetPct', label: `Within ${e.sla} min %` }], rows: byWho },
      { name: 'by_day', title: 'First response per day', columns: [{ key: 'date', label: 'Date' }, { key: 'conversations', label: 'Conversations' }, { key: 'medianMinutes', label: 'Median minutes' }], rows: trend }],
    };
  }

  // ------------------------------------------------------------------ 5. appointment outcomes
  private async appointments(e: Env): Promise<Body> {
    const own = e.own ? Prisma.sql`AND a.membership_id = ${e.ctx.membershipId}::uuid` : Prisma.empty;
    const base = Prisma.sql`FROM appointments a WHERE a.tenant_id = ${e.ctx.tenantId}::uuid AND a.starts_at >= ${e.range.from} AND a.starts_at < ${e.range.to} ${own}`;
    const status = await e.tx.$queryRaw<{ s: string; n: number }[]>`SELECT a.status::text AS s, count(*)::int AS n ${base} GROUP BY 1`;
    const days = await e.tx.$queryRaw<{ d: string; booked: number; completed: number }[]>`SELECT to_char((a.starts_at AT TIME ZONE ${e.tz})::date, 'YYYY-MM-DD') AS d, count(*)::int AS booked, count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed ${base} GROUP BY 1`;
    const bySource = await e.tx.$queryRaw<{ source: string; n: number; done: number }[]>`SELECT a.source AS source, count(*)::int AS n, count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS done ${base} GROUP BY 1 ORDER BY n DESC`;
    const byAgent = await e.tx.$queryRaw<{ name: string; n: number; done: number; no_show: number; cancelled: number }[]>`
      SELECT u.name, count(*)::int AS n, count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS done, count(*) FILTER (WHERE a.status = 'NO_SHOW')::int AS no_show, count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled
      FROM appointments a JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id WHERE a.tenant_id = ${e.ctx.tenantId}::uuid AND a.starts_at >= ${e.range.from} AND a.starts_at < ${e.range.to} ${own} GROUP BY 1 ORDER BY n DESC, u.name`;
    const g = (s: string) => status.find((x) => x.s === s)?.n ?? 0;
    const total = status.reduce((a, s) => a + s.n, 0);
    const trend = this.fill(e, new Map(days.map((r) => [r.d, { booked: r.booked, completed: r.completed }])), (d, r) => ({ date: d, booked: num(r?.booked), completed: num(r?.completed) }));
    return {
      summary: { total, completed: g('COMPLETED'), noShow: g('NO_SHOW'), cancelled: g('CANCELLED'), upcomingOrPending: g('PENDING') + g('CONFIRMED'), showRatePct: pct(g('COMPLETED'), g('COMPLETED') + g('NO_SHOW')), cancellationRatePct: pct(g('CANCELLED'), total) },
      series: { statuses: status.map((s) => ({ status: s.s, count: s.n })), trend },
      tables: [{ name: 'by_agent', title: 'Appointments by agent', columns: [{ key: 'agent', label: 'Agent' }, { key: 'appointments', label: 'Appointments' }, { key: 'completed', label: 'Completed' }, { key: 'noShows', label: 'No-shows' }, { key: 'cancelled', label: 'Cancelled' }], rows: byAgent.map((r) => ({ agent: r.name, appointments: r.n, completed: r.done, noShows: r.no_show, cancelled: r.cancelled })) },
      { name: 'by_source', title: 'Appointments by how they were booked', columns: [{ key: 'source', label: 'Booked via' }, { key: 'appointments', label: 'Appointments' }, { key: 'completed', label: 'Completed' }], rows: bySource.map((r) => ({ source: r.source, appointments: r.n, completed: r.done })) },
      { name: 'by_day', title: 'Appointments per day', columns: [{ key: 'date', label: 'Date' }, { key: 'booked', label: 'Scheduled' }, { key: 'completed', label: 'Completed' }], rows: trend }],
    };
  }

  // ------------------------------------------------------------------ 6. AI conversation stats (managers)
  private async ai(e: Env): Promise<Body> {
    const where = Prisma.sql`r.tenant_id = ${e.ctx.tenantId}::uuid AND r.created_at >= ${e.range.from} AND r.created_at < ${e.range.to}`;
    const [tot] = await e.tx.$queryRaw<{ runs: number; completed: number; skipped: number; failed: number; conversations: number; handovers: number; tin: number; tout: number; avg_ms: number | null; p95_ms: number | null; blocked: number }[]>`
      SELECT count(*)::int AS runs, count(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE r.status = 'SKIPPED')::int AS skipped, count(*) FILTER (WHERE r.status = 'FAILED')::int AS failed,
        count(DISTINCT r.conversation_id)::int AS conversations,
        count(DISTINCT r.conversation_id) FILTER (WHERE r.trace->'tools' @> '[{"name":"handover_to_human"}]'::jsonb)::int AS handovers,
        COALESCE(sum(r.input_tokens), 0)::bigint AS tin, COALESCE(sum(r.output_tokens), 0)::bigint AS tout,
        avg(r.latency_ms) FILTER (WHERE r.status = 'COMPLETED') AS avg_ms, percentile_cont(0.95) WITHIN GROUP (ORDER BY r.latency_ms) FILTER (WHERE r.status = 'COMPLETED' AND r.latency_ms IS NOT NULL) AS p95_ms,
        count(*) FILTER (WHERE jsonb_array_length(COALESCE(r.trace->'guard'->'violations', '[]'::jsonb)) > 0)::int AS blocked
      FROM ai_runs r WHERE ${where}`;
    const days = await e.tx.$queryRaw<{ d: string; runs: number; tokens: number }[]>`SELECT to_char((r.created_at AT TIME ZONE ${e.tz})::date, 'YYYY-MM-DD') AS d, count(*)::int AS runs, (COALESCE(sum(r.input_tokens), 0) + COALESCE(sum(r.output_tokens), 0))::bigint AS tokens FROM ai_runs r WHERE ${where} GROUP BY 1`;
    const outcomes = await e.tx.$queryRaw<{ o: string | null; n: number }[]>`SELECT r.trace->>'outcome' AS o, count(*)::int AS n FROM ai_runs r WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 10`;
    const tools = await e.tx.$queryRaw<{ tool: string; n: number }[]>`SELECT t->>'name' AS tool, count(*)::int AS n FROM ai_runs r, jsonb_array_elements(COALESCE(r.trace->'tools', '[]'::jsonb)) t WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 12`;
    const t = tot ?? { runs: 0, completed: 0, skipped: 0, failed: 0, conversations: 0, handovers: 0, tin: 0, tout: 0, avg_ms: null, p95_ms: null, blocked: 0 };
    const trend = this.fill(e, new Map(days.map((r) => [r.d, { runs: r.runs, tokens: num(r.tokens) }])), (d, r) => ({ date: d, runs: num(r?.runs), tokens: num(r?.tokens) }));
    return {
      summary: { aiTurns: t.runs, conversationsHandled: t.conversations, handoverRatePct: pct(t.handovers, t.conversations), handovers: t.handovers, completed: t.completed, skipped: t.skipped, failed: t.failed, inputTokens: num(t.tin), outputTokens: num(t.tout), avgLatencyMs: t.avg_ms === null ? null : Math.round(Number(t.avg_ms)), p95LatencyMs: t.p95_ms === null ? null : Math.round(Number(t.p95_ms)), repliesBlockedByGuards: t.blocked },
      series: { trend, outcomes: outcomes.map((o) => ({ outcome: o.o ?? 'none', count: o.n })) },
      tables: [{ name: 'tools', title: 'Tool calls', columns: [{ key: 'tool', label: 'Tool' }, { key: 'calls', label: 'Calls' }], rows: tools.map((x) => ({ tool: x.tool, calls: x.n })) },
      { name: 'outcomes', title: 'Turn outcomes', columns: [{ key: 'outcome', label: 'Outcome' }, { key: 'count', label: 'Turns' }], rows: outcomes.map((o) => ({ outcome: o.o ?? 'none', count: o.n })) },
      { name: 'by_day', title: 'AI turns per day', columns: [{ key: 'date', label: 'Date' }, { key: 'runs', label: 'Turns' }, { key: 'tokens', label: 'Tokens' }], rows: trend }],
    };
  }

  // ------------------------------------------------------------------ 7. automation summary (managers)
  private async automations(e: Env): Promise<Body> {
    const where = Prisma.sql`r.tenant_id = ${e.ctx.tenantId}::uuid AND r.status <> 'DRY_RUN' AND r.created_at >= ${e.range.from} AND r.created_at < ${e.range.to}`;
    const by = await e.tx.$queryRaw<{ name: string; enabled: boolean; runs: number; ok: number; failed: number; skipped: number; pending: number }[]>`
      SELECT a.name, a.enabled, count(*)::int AS runs, count(*) FILTER (WHERE r.status = 'SUCCEEDED')::int AS ok, count(*) FILTER (WHERE r.status = 'FAILED')::int AS failed,
        count(*) FILTER (WHERE r.status = 'SKIPPED')::int AS skipped, count(*) FILTER (WHERE r.status IN ('QUEUED', 'RUNNING'))::int AS pending
      FROM automation_runs r JOIN automations a ON a.id = r.automation_id WHERE ${where} GROUP BY a.id, a.name, a.enabled ORDER BY runs DESC, a.name`;
    const days = await e.tx.$queryRaw<{ d: string; ok: number; failed: number }[]>`SELECT to_char((r.created_at AT TIME ZONE ${e.tz})::date, 'YYYY-MM-DD') AS d, count(*) FILTER (WHERE r.status = 'SUCCEEDED')::int AS ok, count(*) FILTER (WHERE r.status = 'FAILED')::int AS failed FROM automation_runs r WHERE ${where} GROUP BY 1`;
    const errors = await e.tx.$queryRaw<{ err: string; n: number }[]>`SELECT left(r.error, 120) AS err, count(*)::int AS n FROM automation_runs r WHERE ${where} AND r.status = 'FAILED' AND r.error IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8`;
    const active = await e.tx.automation.count({ where: { tenantId: e.ctx.tenantId, enabled: true } });
    const sum = (k: 'runs' | 'ok' | 'failed' | 'skipped') => by.reduce((a, r) => a + r[k], 0);
    const trend = this.fill(e, new Map(days.map((r) => [r.d, { ok: r.ok, failed: r.failed }])), (d, r) => ({ date: d, succeeded: num(r?.ok), failed: num(r?.failed) }));
    return {
      summary: { activeAutomations: active, runs: sum('runs'), succeeded: sum('ok'), failed: sum('failed'), skipped: sum('skipped'), successRatePct: pct(sum('ok'), sum('ok') + sum('failed')) },
      series: { trend },
      tables: [{ name: 'by_automation', title: 'Runs by automation', columns: [{ key: 'automation', label: 'Automation' }, { key: 'enabled', label: 'On' }, { key: 'runs', label: 'Runs' }, { key: 'succeeded', label: 'Succeeded' }, { key: 'failed', label: 'Failed' }, { key: 'skipped', label: 'Skipped' }], rows: by.map((r) => ({ automation: r.name, enabled: r.enabled ? 'yes' : 'no', runs: r.runs, succeeded: r.ok, failed: r.failed, skipped: r.skipped })) },
      { name: 'failures', title: 'Most common failures', columns: [{ key: 'error', label: 'Error' }, { key: 'count', label: 'Runs' }], rows: errors.map((r) => ({ error: r.err, count: r.n })) },
      { name: 'by_day', title: 'Runs per day', columns: [{ key: 'date', label: 'Date' }, { key: 'succeeded', label: 'Succeeded' }, { key: 'failed', label: 'Failed' }], rows: trend }],
    };
  }
}

interface Env { tx: Parameters<Parameters<DbService['tenantTx']>[1]>[0]; ctx: TenantRequestContext; tz: string; range: Range; own: boolean; sla: number }
type Body = Pick<ReportResult, 'summary' | 'series' | 'tables'>;
