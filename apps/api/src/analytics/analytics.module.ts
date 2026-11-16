import { series } from '../common/series.js';
import { BadRequestException, Controller, ForbiddenException, Get, Inject, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@leadpilot/database';
import { analyticsQuerySchema, type AnalyticsQuery } from '@leadpilot/validation';
import { CurrentTenant } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { addDays, previousRange, resolveRange, startOfDay } from './date-range.js';

const pct = (cur: number, prev: number): number | null => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 1000) / 10);

/**
 * Metric definitions (also returned by the API so the UI can show them):
 *  - totalLeads: all non-deleted leads right now.
 *  - newLeads: leads created in the range.   qualifiedLeads: of those, leads now at/after a qualifying stage or won.
 *  - hotLeads: open leads that are HOT or score >= 70, right now.
 *  - converted: leads moved to a Won stage during the range.
 *  - conversionRate: of leads created in the range, the share that are Won now.
 *  - appointments*: not available until the appointments module ships (null, never invented).
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async overview(ctx: TenantRequestContext, q: AnalyticsQuery) {
    const all = ctx.permissions.has('analytics:read:all');
    if (!all && !ctx.permissions.has('analytics:read:own')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot view analytics' });
    if (q.range === 'custom' && (!q.from || !q.to)) throw new BadRequestException({ code: 'validation_error', message: 'Custom ranges need a start and end date' });
    return this.db.tenantTx(ctx, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true } });
      const tz = tenant.timezone;
      const range = resolveRange(q, tz);
      if (range.to.getTime() - range.from.getTime() > 400 * 86_400_000) throw new BadRequestException({ code: 'range_too_large', message: 'Choose a range of up to 13 months' });
      const prev = previousRange(range);
      const scope: Prisma.LeadWhereInput = all ? {} : { assignedMembershipId: ctx.membershipId };
      const base: Prisma.LeadWhereInput = { tenantId: ctx.tenantId, deletedAt: null, ...scope };
      const inRange = (r: { from: Date; to: Date }): Prisma.LeadWhereInput => ({ ...base, createdAt: { gte: r.from, lt: r.to } });
      const qualifiesStage: Prisma.LeadWhereInput = { stage: { OR: [{ qualifies: true }, { kind: 'WON' }] } };
      const wonNow: Prisma.LeadWhereInput = { stage: { kind: 'WON' } };
      const hotNow: Prisma.LeadWhereInput = { ...base, stage: { kind: 'OPEN' }, OR: [{ temperature: 'HOT' }, { score: { gte: 70 } }] };
      const convertedIn = (r: { from: Date; to: Date }) => tx.stageTransition.findMany({ where: { tenantId: ctx.tenantId, createdAt: { gte: r.from, lt: r.to }, lead: { is: { ...base } } }, select: { leadId: true, toStageId: true }, distinct: ['leadId', 'toStageId'] })
        .then(async (rows) => { const won = new Set((await tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId, kind: 'WON' }, select: { id: true } })).map((s) => s.id)); return new Set(rows.filter((r2) => won.has(r2.toStageId)).map((r2) => r2.leadId)).size; });

      const [total, newCur, newPrev, qualCur, qualPrev, hot, convCur, convPrev, wonCohort, wonCohortPrev] = await series([ () => tx.lead.count({ where: base }), () => tx.lead.count({ where: inRange(range) }), () => tx.lead.count({ where: inRange(prev) }), () => tx.lead.count({ where: { AND: [inRange(range), qualifiesStage] } }), () => tx.lead.count({ where: { AND: [inRange(prev), qualifiesStage] } }), () => tx.lead.count({ where: hotNow }), () => convertedIn(range), () => convertedIn(prev), () => tx.lead.count({ where: { AND: [inRange(range), wonNow] } }), () => tx.lead.count({ where: { AND: [inRange(prev), wonNow] } })]);
      const rate = newCur ? Math.round((wonCohort / newCur) * 1000) / 10 : 0;
      const ratePrev = newPrev ? Math.round((wonCohortPrev / newPrev) * 1000) / 10 : 0;

      // Daily trend in the tenant's timezone, zero-filled.
      const assignedClause = all ? Prisma.empty : Prisma.sql`AND assigned_membership_id = ${ctx.membershipId}::uuid`;
      const days = await tx.$queryRaw<{ d: string; n: number }[]>`
        SELECT to_char((created_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS d, count(*)::int AS n
        FROM leads WHERE tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL ${assignedClause}
          AND created_at >= ${range.from} AND created_at < ${range.to}
        GROUP BY 1 ORDER BY 1`;
      const byDay = new Map(days.map((r) => [r.d, r.n]));
      const trend: { date: string; leads: number }[] = [];
      for (let t = range.from; t < range.to; t = addDays(t, 1, tz)) {
        const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(t.getTime() + 3 * 3600_000));
        trend.push({ date: key, leads: byDay.get(key) ?? 0 });
        if (trend.length > 400) break;
      }

      const [stages, stageCounts, sourceCounts, sources, agentRows, recent, hotList, followups] = await series([ () => tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } }), () => tx.lead.groupBy({ by: ['stageId'], where: base, _count: { _all: true } }), () => tx.lead.groupBy({ by: ['sourceId'], where: inRange(range), _count: { _all: true } }), () => tx.leadSource.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }), () => all || ctx.permissions.has('analytics:read:team') ? tx.lead.groupBy({ by: ['assignedMembershipId'], where: { ...base, stage: { kind: 'OPEN' } }, _count: { _all: true } }) : Promise.resolve([]), () => tx.lead.findMany({ where: base, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, createdAt: true, stage: { select: { name: true } }, source: { select: { name: true } }, temperature: true } }), () => tx.lead.findMany({ where: hotNow, orderBy: [{ lastContactedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }], take: 5, select: { id: true, name: true, score: true, lastContactedAt: true, nextFollowUpAt: true, stage: { select: { name: true } } } }), () => tx.lead.findMany({ where: { ...base, stage: { kind: 'OPEN' }, nextFollowUpAt: { gte: new Date(), lt: addDays(startOfDay(new Date(), tz), 8, tz) } }, orderBy: { nextFollowUpAt: 'asc' }, take: 5, select: { id: true, name: true, nextFollowUpAt: true } })]);
      const stageCount = new Map(stageCounts.map((c) => [c.stageId, c._count._all]));
      const srcName = new Map(sources.map((s) => [s.id, s.name]));
      const wonStageIds = stages.filter((s) => s.kind === 'WON').map((s) => s.id);
      const wonBySource = await tx.lead.groupBy({ by: ['sourceId'], where: { AND: [inRange(range), { stageId: { in: wonStageIds } }] }, _count: { _all: true } });
      const wonSrc = new Map(wonBySource.map((c) => [c.sourceId, c._count._all]));

      const members = await tx.membership.findMany({ where: { id: { in: agentRows.map((r) => r.assignedMembershipId).filter((x): x is string => x !== null) } }, select: { id: true, userId: true } });
      const users = await tx.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true } });
      const memberName = new Map(members.map((m) => [m.id, users.find((u) => u.id === m.userId)?.name ?? 'Unknown']));

      return {
        range: { label: range.label, from: range.from.toISOString(), to: range.to.toISOString(), timezone: tz },
        kpis: {
          totalLeads: { value: total, deltaPct: null },
          newLeads: { value: newCur, deltaPct: pct(newCur, newPrev) },
          qualifiedLeads: { value: qualCur, deltaPct: pct(qualCur, qualPrev) },
          hotLeads: { value: hot, deltaPct: null },
          converted: { value: convCur, deltaPct: pct(convCur, convPrev) },
          conversionRate: { value: rate, deltaPct: pct(rate, ratePrev) },
          appointmentsBooked: null, appointmentsCompleted: null,
        },
        trend,
        sources: sourceCounts.map((c) => ({ name: c.sourceId ? srcName.get(c.sourceId) ?? 'Unknown' : 'Unknown', leads: c._count._all, won: wonSrc.get(c.sourceId) ?? 0 })).sort((x, y) => y.leads - x.leads),
        pipeline: stages.map((s) => ({ stage: s.name, kind: s.kind, count: stageCount.get(s.id) ?? 0 })),
        agents: agentRows.map((r) => ({ membershipId: r.assignedMembershipId, name: r.assignedMembershipId ? memberName.get(r.assignedMembershipId) ?? 'Unknown' : 'Unassigned', openLeads: r._count._all })).sort((x, y) => y.openLeads - x.openLeads),
        recentLeads: recent.map((l) => ({ id: l.id, name: l.name, createdAt: l.createdAt.toISOString(), stage: l.stage.name, source: l.source?.name ?? null, temperature: l.temperature })),
        hotLeads: hotList.map((l) => ({ id: l.id, name: l.name, score: l.score, stage: l.stage.name, lastContactedAt: l.lastContactedAt?.toISOString() ?? null, nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null })),
        upcomingFollowUps: followups.map((l) => ({ id: l.id, name: l.name, at: l.nextFollowUpAt?.toISOString() ?? null })),
        notAvailableYet: ['appointments', 'ai conversations', 'automation executions'],
      };
    });
  }

  async workload(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const members = await tx.membership.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, select: { id: true, userId: true, role: { select: { name: true, key: true } } } });
      const users = await tx.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
      const open = await tx.lead.groupBy({ by: ['assignedMembershipId'], where: { tenantId: ctx.tenantId, deletedAt: null, stage: { kind: 'OPEN' } }, _count: { _all: true } });
      const overdue = await tx.lead.groupBy({ by: ['assignedMembershipId'], where: { tenantId: ctx.tenantId, deletedAt: null, stage: { kind: 'OPEN' }, nextFollowUpAt: { lt: new Date() } }, _count: { _all: true } });
      const o = new Map(open.map((r) => [r.assignedMembershipId, r._count._all]));
      const d = new Map(overdue.map((r) => [r.assignedMembershipId, r._count._all]));
      return {
        members: members.map((m) => { const u = users.find((x) => x.id === m.userId); return { membershipId: m.id, name: u?.name ?? 'Unknown', email: u?.email ?? '', role: m.role.name, openLeads: o.get(m.id) ?? 0, overdueFollowUps: d.get(m.id) ?? 0 }; }),
        unassignedOpenLeads: o.get(null) ?? 0,
      };
    });
  }
}

@Controller()
class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly svc: AnalyticsService) {}
  @Get('analytics/overview') overview(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery) { return this.svc.overview(ctx, q); }
  @Get('team/workload') workload(@CurrentTenant() ctx: TenantRequestContext) {
    if (!ctx.permissions.has('analytics:read:team')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot view team workload' });
    return this.svc.workload(ctx);
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
