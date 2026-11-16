import { EntitlementsService } from '../billing/entitlements.service.js';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { actionSchema, automationInputSchema, type AutomationAction, type AutomationInput } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { AutomationEngine } from './automation-engine.js';
import { AUTOMATION_TEMPLATES } from './automation-templates.js';

type Row = Prisma.AutomationGetPayload<object>;

@Injectable()
export class AutomationsService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService, @Inject(AutomationEngine) private readonly engine: AutomationEngine, @Inject(EntitlementsService) private readonly ent: EntitlementsService) {}

  private tx<T>(a: Actor, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, fn); }

  private async dto(tx: TxClient, tenantId: string, rows: Row[]) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const stats = await tx.automationRun.groupBy({ by: ['automationId', 'status'], where: { tenantId, createdAt: { gte: since } }, _count: { _all: true } });
    const registered = new Set((await tx.whatsappTemplate.findMany({ where: { tenantId }, select: { name: true } })).map((t) => t.name));
    return rows.map((r) => {
      const mine = stats.filter((s) => s.automationId === r.id);
      const count = (st: string) => mine.find((s) => s.status === st)?._count._all ?? 0;
      const needs = [...new Set((r.actions as unknown as AutomationAction[]).flatMap((a) => (a.type === 'send_whatsapp_template' ? [a.template] : [])))];
      return {
        id: r.id, templateKey: r.templateKey, name: r.name, description: r.description, enabled: r.enabled, trigger: r.trigger, conditions: r.conditions, actions: r.actions, cooldownMinutes: r.cooldownMinutes,
        missingWhatsappTemplates: needs.filter((n) => !registered.has(n)),
        last7Days: { succeeded: count('SUCCEEDED'), failed: count('FAILED'), skipped: count('SKIPPED') },
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async list(a: Actor) { return this.tx(a, async (tx) => ({ items: await this.dto(tx, a.tenantId, await tx.automation.findMany({ where: { tenantId: a.tenantId }, orderBy: { createdAt: 'asc' } })) })); }

  async templates(a: Actor) {
    return this.tx(a, async (tx) => {
      const installed = new Set((await tx.automation.findMany({ where: { tenantId: a.tenantId, templateKey: { not: null } }, select: { templateKey: true } })).map((r) => r.templateKey));
      return { items: AUTOMATION_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, category: t.category, trigger: t.trigger, actions: t.actions, requiresWhatsappTemplates: t.requiresWhatsappTemplates, installed: installed.has(t.key) })) };
    });
  }

  private async validateActions(tx: TxClient, a: Actor, actions: AutomationAction[]): Promise<void> {
    for (const act of actions) {
      if (act.type === 'assign_to' || (act.type === 'create_task' && act.assignee !== 'lead_owner')) {
        const id = act.type === 'assign_to' ? act.membershipId : (act.assignee as string);
        if (!(await tx.membership.findFirst({ where: { id, tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true } }))) throw new BadRequestException({ code: 'invalid_assignee', message: 'One of the actions names a team member who is not active' });
      }
      if (act.type === 'change_stage' && !(await tx.pipelineStage.findFirst({ where: { tenantId: a.tenantId, key: act.stageKey }, select: { id: true } }))) throw new BadRequestException({ code: 'invalid_stage', message: `Stage "${act.stageKey}" does not exist` });
    }
  }

  async create(a: Actor, input: AutomationInput, templateKey: string | null = null) {
    const row = await this.tx(a, async (tx) => {
      await this.validateActions(tx, a, input.actions);
      const r = await tx.automation.create({ data: { id: uuidv7(), tenantId: a.tenantId, templateKey, name: input.name, description: input.description ?? null, enabled: false, trigger: input.trigger as Prisma.InputJsonObject, conditions: input.conditions as unknown as Prisma.InputJsonArray, actions: input.actions as unknown as Prisma.InputJsonArray, cooldownMinutes: input.cooldownMinutes, createdBy: a.userId } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'automation.created', resourceType: 'automation', resourceId: r.id, metadata: { templateKey }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return r;
    });
    return this.get(a, row.id);
  }

  async fromTemplate(a: Actor, key: string) {
    const t = AUTOMATION_TEMPLATES.find((x) => x.key === key);
    if (!t) throw new NotFoundException({ code: 'not_found', message: 'Unknown template' });
    const parsed = automationInputSchema.parse({ name: t.name, description: t.description, trigger: t.trigger, conditions: t.conditions, actions: t.actions, cooldownMinutes: t.cooldownMinutes });
    const exists = await this.tx(a, (tx) => tx.automation.findFirst({ where: { tenantId: a.tenantId, templateKey: key }, select: { id: true } }));
    if (exists) throw new ConflictException({ code: 'already_installed', message: 'This template is already in your automations' });
    return this.create(a, parsed, key);
  }

  async get(a: Actor, id: string) {
    return this.tx(a, async (tx) => {
      const r = await tx.automation.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!r) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      return (await this.dto(tx, a.tenantId, [r]))[0];
    });
  }

  async update(a: Actor, id: string, input: AutomationInput) {
    await this.tx(a, async (tx) => {
      const cur = await tx.automation.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      await this.validateActions(tx, a, input.actions);
      await tx.automation.update({ where: { id }, data: { name: input.name, description: input.description ?? null, trigger: input.trigger as Prisma.InputJsonObject, conditions: input.conditions as unknown as Prisma.InputJsonArray, actions: input.actions as unknown as Prisma.InputJsonArray, cooldownMinutes: input.cooldownMinutes } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'automation.updated', resourceType: 'automation', resourceId: id, metadata: {}, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
    return this.get(a, id);
  }

  async setEnabled(a: Actor, id: string, enabled: boolean) {
    await this.tx(a, async (tx) => {
      const cur = await tx.automation.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      // Re-validate on enable: stages/members referenced earlier may have been removed.
      if (enabled && !cur.enabled) await this.ent.assertCanAdd(a.tenantId, 'active_automations', 'active automations');
      if (enabled) { actionSchema.array().parse(cur.actions); await this.validateActions(tx, a, cur.actions as unknown as AutomationAction[]); }
      await tx.automation.update({ where: { id }, data: { enabled } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: enabled ? 'automation.enabled' : 'automation.disabled', resourceType: 'automation', resourceId: id, metadata: {}, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
    return this.get(a, id);
  }

  async remove(a: Actor, id: string): Promise<void> {
    await this.tx(a, async (tx) => {
      const r = await tx.automation.deleteMany({ where: { id, tenantId: a.tenantId } });
      if (r.count === 0) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'automation.deleted', resourceType: 'automation', resourceId: id, metadata: {}, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
  }

  async dryRun(a: Actor, id: string, leadId: string, appointmentId?: string) {
    const automation = await this.tx(a, (tx) => tx.automation.findFirst({ where: { id, tenantId: a.tenantId } }));
    if (!automation) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
    return this.engine.dryRun(a.tenantId, automation, leadId, appointmentId);
  }

  async runs(a: Actor, q: { automationId?: string | undefined; status?: string | undefined; limit: number; cursor?: string | undefined }) {
    return this.tx(a, async (tx) => {
      const rows = await tx.automationRun.findMany({
        where: { tenantId: a.tenantId, ...(q.automationId ? { automationId: q.automationId } : {}), ...(q.status ? { status: q.status as 'FAILED' } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: { automation: { select: { name: true } } },
      });
      const page = rows.slice(0, q.limit);
      const leads = await tx.lead.findMany({ where: { id: { in: page.flatMap((r) => (r.leadId ? [r.leadId] : [])) } }, select: { id: true, name: true } });
      const L = new Map(leads.map((l) => [l.id, l.name]));
      return {
        items: page.map((r) => ({ id: r.id, automationId: r.automationId, automationName: r.automation.name, eventType: r.eventType, leadId: r.leadId, leadName: r.leadId ? L.get(r.leadId) ?? null : null, status: r.status, attempts: r.attempts, error: r.error, steps: r.steps, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })),
        nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    });
  }

  /** A FAILED run goes back on the queue. Steps that already succeeded are not repeated. */
  async retryRun(a: Actor, runId: string) {
    await this.tx(a, async (tx) => {
      const r = await tx.automationRun.updateMany({ where: { id: runId, tenantId: a.tenantId, status: 'FAILED' }, data: { status: 'QUEUED', error: null, finishedAt: null } });
      if (r.count === 0) throw new ConflictException({ code: 'not_retryable', message: 'Only failed runs can be retried' });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'automation.run_retried', resourceType: 'automation_run', resourceId: runId, metadata: {}, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
    return { queued: true };
  }
}
