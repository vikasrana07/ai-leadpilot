import { Controller, Get, Inject, Module } from '@nestjs/common';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveRange } from '../analytics/date-range.js';
import { AiModule } from '../ai/ai.module.js';
import { AssistantsService } from '../ai/assistants.service.js';
import { DbService } from '../db/db.module.js';

/** Plain counts for the billing period (calendar month in the workspace timezone). Metering only: nothing here blocks or bills. */
@Controller('usage') @RequirePermissions('usage:read')
class UsageController {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AssistantsService) private readonly assistants: AssistantsService) {}

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
      const n = (s: string) => runs.find((x) => x.status === s)?._count._all ?? 0;
      return {
        period: { from: r.from.toISOString(), to: r.to.toISOString(), timezone: tz },
        ai: { runs: ai.runs, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, tokensUsed: ai.used, cap: ai.cap, pct: ai.pct, warning: ai.warning, exceeded: ai.exceeded },
        messages: { inbound, aiReplies, agentReplies: agentMsgs, automatedTemplates: systemMsgs },
        leads: { created: leads }, appointments: { created: appts },
        automations: { succeeded: n('SUCCEEDED'), failed: n('FAILED'), skipped: n('SKIPPED') },
        storage: { documents: docs._count._all, bytes: docs._sum.sizeBytes ?? 0 }, seats: { active: seats },
      };
    });
  }
}

@Module({ imports: [AiModule], controllers: [UsageController] })
export class UsageModule {}
