import { Controller, Get, Inject, Module } from '@nestjs/common';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveRange } from '../analytics/date-range.js';
import { AiModule } from '../ai/ai.module.js';
import { AssistantsService } from '../ai/assistants.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DbService } from '../db/db.module.js';

/** Plain counts for the billing period (calendar month in the workspace timezone). Metering only: nothing here blocks or bills. */
@Controller('usage') @RequirePermissions('usage:read')
class UsageController {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AssistantsService) private readonly assistants: AssistantsService, @Inject(EntitlementsService) private readonly ent: EntitlementsService) {}

  @Get()
  async get(@CurrentTenant() c: TenantRequestContext) {
    const a = actorFrom(c);
    const ai = await this.assistants.usage(a.tenantId, a.userId ?? undefined);
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { timezone: true } })).timezone;
      const r = resolveRange({ range: 'month' }, tz);
      const inRange = { gte: r.from, lt: r.to };
      const count = async (p: Promise<number>) => p;
      const inbound = await count(tx.message.count({ where: { direction: 'INBOUND', createdAt: inRange } }));
      const aiReplies = await count(tx.message.count({ where: { direction: 'OUTBOUND', senderType: 'AI', createdAt: inRange } }));
      const agentMsgs = await count(tx.message.count({ where: { direction: 'OUTBOUND', senderType: 'AGENT', createdAt: inRange } }));
      const systemMsgs = await count(tx.message.count({ where: { direction: 'OUTBOUND', senderType: 'SYSTEM', type: 'TEMPLATE', createdAt: inRange } }));
      const leads = await count(tx.lead.count({ where: { createdAt: inRange } }));
      const appts = await count(tx.appointment.count({ where: { createdAt: inRange } }));
      const runs = await tx.automationRun.groupBy({ by: ['status'], where: { createdAt: inRange }, _count: { _all: true } });
      const docs = await tx.knowledgeDocument.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } });
      const seats = await count(tx.membership.count({ where: { status: 'ACTIVE' } }));
      const plan = await this.ent.compute(tx, a.tenantId);
      const meter = await this.ent.usage(tx, a.tenantId);
      const n = (s: string) => runs.find((x) => x.status === s)?._count._all ?? 0;
      return {
        plan: { key: plan.planKey, name: plan.planName, status: plan.status, restricted: plan.restricted, limits: plan.limits, features: plan.features, meters: meter },
        period: { from: r.from.toISOString(), to: r.to.toISOString(), timezone: tz },
        ai: { runs: ai.runs, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, tokensUsed: ai.used, cap: ai.cap, pct: ai.pct, warning: ai.warning, exceeded: ai.exceeded, level: ai.level, capSource: ai.capSource, inGrace: ai.inGrace, projectedExhaustionAt: ai.projectedExhaustionAt, resetsAt: ai.resetsAt },
        messages: { inbound, aiReplies, agentReplies: agentMsgs, automatedTemplates: systemMsgs },
        leads: { created: leads }, appointments: { created: appts },
        automations: { succeeded: n('SUCCEEDED'), failed: n('FAILED'), skipped: n('SKIPPED') },
        storage: { documents: docs._count._all, bytes: docs._sum.sizeBytes ?? 0 }, seats: { active: seats },
      };
    });
  }

  @Get('history')
  async history(@CurrentTenant() c: TenantRequestContext) {
    const a = actorFrom(c);
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const days = 14;
      const since = new Date(Date.now() - days * 86_400_000);
      const [runs, msgs, leads] = await Promise.all([
        tx.aiRun.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, inputTokens: true, outputTokens: true } }),
        tx.message.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
        tx.lead.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      ]);

      const buckets = new Map<string, { date: string; aiTokens: number; messages: number; leads: number }>();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        buckets.set(d, { date: d, aiTokens: 0, messages: 0, leads: 0 });
      }
      for (const r of runs) {
        const k = r.createdAt.toISOString().slice(0, 10);
        const b = buckets.get(k);
        if (b) b.aiTokens += r.inputTokens + r.outputTokens;
      }
      for (const m of msgs) {
        const k = m.createdAt.toISOString().slice(0, 10);
        const b = buckets.get(k);
        if (b) b.messages += 1;
      }
      for (const l of leads) {
        const k = l.createdAt.toISOString().slice(0, 10);
        const b = buckets.get(k);
        if (b) b.leads += 1;
      }
      return [...buckets.values()];
    });
  }
}

@Module({ imports: [AiModule], controllers: [UsageController] })
export class UsageModule {}
