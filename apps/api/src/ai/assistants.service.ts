import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@leadpilot/database';
import type { AssistantInput } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { resolveRange } from '../analytics/date-range.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';

export const DEFAULT_TOOLS = ['get_business_info', 'search_properties', 'get_lead_details', 'update_lead', 'calculate_lead_score', 'create_followup', 'handover_to_human'];
const DEFAULT_HANDOVER = { keywords: ['human', 'real person', 'speak to a person', 'talk to someone', 'call me', 'insaan'], onNegotiation: true, onComplaint: true };
const EMPTY_DAY = null;

@Injectable()
export class AssistantsService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService, @Inject(ENV) private readonly env: Env) {}

  private view(a: Prisma.AiAssistantGetPayload<object>) {
    return {
      enabled: a.enabled, name: a.name, businessIdentity: a.businessIdentity, businessDescription: a.businessDescription, languages: a.languages, tone: a.tone,
      welcomeMessage: a.welcomeMessage, systemInstructions: a.systemInstructions,
      workingHours: (Object.keys(a.workingHours as object).length ? a.workingHours : { enabled: false, days: { mon: EMPTY_DAY, tue: EMPTY_DAY, wed: EMPTY_DAY, thu: EMPTY_DAY, fri: EMPTY_DAY, sat: EMPTY_DAY, sun: EMPTY_DAY } }) as AssistantInput['workingHours'],
      handoverRules: (Object.keys(a.handoverRules as object).length ? a.handoverRules : DEFAULT_HANDOVER) as AssistantInput['handoverRules'],
      allowedTools: a.allowedTools, model: a.model, temperature: a.temperature, maxReplyChars: a.maxReplyChars, fallbackMessage: a.fallbackMessage, disclosureText: a.disclosureText, monthlyTokenCap: a.monthlyTokenCap,
    };
  }

  /** The assistant exists lazily: reading creates a disabled default row so the settings page always has something to edit. */
  async get(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, industry: true } });
      let a = await tx.aiAssistant.findUnique({ where: { tenantId: ctx.tenantId } });
      a ??= await tx.aiAssistant.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, businessIdentity: t.name, allowedTools: DEFAULT_TOOLS, handoverRules: DEFAULT_HANDOVER } });
      return this.view(a);
    });
  }

  save(ctx: TenantRequestContext, input: AssistantInput) {
    if (!ctx.permissions.has('ai:configure')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot configure the assistant' });
    return this.db.tenantTx(ctx, async (tx) => {
      const data = {
        enabled: input.enabled, name: input.name, businessIdentity: input.businessIdentity, businessDescription: input.businessDescription, languages: input.languages, tone: input.tone,
        welcomeMessage: input.welcomeMessage, systemInstructions: input.systemInstructions, workingHours: input.workingHours as unknown as Prisma.InputJsonValue, handoverRules: input.handoverRules as unknown as Prisma.InputJsonValue,
        allowedTools: input.allowedTools, model: input.model, temperature: input.temperature, maxReplyChars: input.maxReplyChars, fallbackMessage: input.fallbackMessage, disclosureText: input.disclosureText, monthlyTokenCap: input.monthlyTokenCap,
      };
      const before = await tx.aiAssistant.findUnique({ where: { tenantId: ctx.tenantId }, select: { enabled: true } });
      const a = await tx.aiAssistant.upsert({ where: { tenantId: ctx.tenantId }, create: { id: uuidv7(), tenantId: ctx.tenantId, ...data }, update: data });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'ai.assistant_configured', resourceType: 'ai_assistant', resourceId: a.id, metadata: { enabled: input.enabled, enabledChanged: before?.enabled !== input.enabled, tools: input.allowedTools.length }, requestId: ctx.requestId, ip: ctx.ip });
      return this.view(a);
    });
  }

  /** Tokens used this month (tenant timezone) against the cap. The cap is a hard stop: the orchestrator refuses to call the model past it. */
  async usage(tenantId: string, userId?: string) {
    return this.db.tenantTx({ tenantId, ...(userId ? { userId } : {}) }, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
      const a = await tx.aiAssistant.findUnique({ where: { tenantId }, select: { monthlyTokenCap: true } });
      const range = resolveRange({ range: 'month' }, t.timezone);
      const agg = await tx.aiRun.aggregate({ where: { tenantId, createdAt: { gte: range.from, lt: range.to } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } });
      const used = (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
      const cap = a?.monthlyTokenCap ?? this.env.AI_DEFAULT_MONTHLY_TOKEN_CAP;
      return { used, inputTokens: agg._sum.inputTokens ?? 0, outputTokens: agg._sum.outputTokens ?? 0, runs: agg._count._all, cap, pct: Math.min(100, Math.round((used / cap) * 1000) / 10), warning: used >= cap * 0.8, exceeded: used >= cap, resetsAt: range.to.toISOString(), killSwitch: this.env.AI_KILL_SWITCH };
    });
  }

  runs(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const rows = await tx.aiRun.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
      return rows.map((r) => {
        const trace = r.trace as { tools?: { name: string; ok: boolean }[]; guard?: { violations?: string[] }; outcome?: string };
        return { id: r.id, conversationId: r.conversationId, status: r.status, model: r.model, promptVersion: r.promptVersion, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, error: r.error, tools: trace.tools ?? [], guardViolations: trace.guard?.violations ?? [], outcome: trace.outcome ?? null, createdAt: r.createdAt.toISOString() };
      });
    });
  }
}
