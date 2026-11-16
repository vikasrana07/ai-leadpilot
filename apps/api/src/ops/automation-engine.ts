import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import type { AutomationAction, AutomationCondition, AutomationTrigger } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { ConversationsService } from '../conversations/conversations.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { evaluateConditions, MAX_CHAIN_DEPTH, render, type EvalContext } from './automation-logic.js';
import { NotificationsService, type CreatedNotification } from './notifications.service.js';
import { OutboxService, originOf } from './outbox.service.js';

export interface StepResult { i: number; type: string; status: 'done' | 'skipped' | 'failed' | 'preview'; detail?: string }
export interface DomainEvent { id: string; tenantId: string; type: string; payload: Record<string, unknown> }

/** A step that cannot succeed because of a business rule (no consent, no phone, template missing...): recorded as skipped, never retried. */
class StepSkip extends Error {}

const MACHINE_PERMISSIONS = new Set(['lead:read:all', 'lead:write:all', 'lead:assign', 'conversation:read:all', 'conversation:reply', 'appointment:read:all', 'appointment:write']);

@Injectable()
export class AutomationEngine {
  private readonly log = new Logger('Automations');
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  private machine(tenantId: string, automationId: string, depth: number): Actor {
    return { tenantId, userId: null, membershipId: null, permissions: MACHINE_PERMISSIONS, requestId: undefined, ip: undefined, origin: { automationId, depth } };
  }

  // ------------------------------------------------------------------ context
  async buildContext(tx: TxClient, tenantId: string, ev: { id: string; type: string; payload: Record<string, unknown> }, overrideLeadId?: string, overrideAppointmentId?: string): Promise<EvalContext | null> {
    const leadId = overrideLeadId ?? (typeof ev.payload.leadId === 'string' ? ev.payload.leadId : null);
    if (!leadId) return null;
    const lead = await tx.lead.findFirst({ where: { id: leadId, deletedAt: null, mergedIntoId: null }, include: { stage: true, source: true } });
    if (!lead) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, timezone: true } });
    const apptId = overrideAppointmentId ?? (typeof ev.payload.appointmentId === 'string' ? ev.payload.appointmentId : null);
    let appointment: EvalContext['appointment'] = null;
    if (apptId) {
      const ap = await tx.appointment.findFirst({ where: { id: apptId } });
      if (ap) { const m = await tx.membership.findFirst({ where: { id: ap.membershipId }, select: { user: { select: { name: true } } } }); appointment = { id: ap.id, startsAt: ap.startsAt, membershipId: ap.membershipId, location: ap.location, agentName: m?.user.name ?? '' }; }
    }
    const toStage = typeof ev.payload.toStage === 'string' ? ev.payload.toStage : null;
    const toTemperature = typeof ev.payload.to === 'string' && ev.type === 'lead.temperature_changed' ? ev.payload.to : null;
    return {
      lead: { id: lead.id, name: lead.name, firstName: lead.name.trim().split(/\s+/)[0] ?? lead.name, stage: lead.stage.key, temperature: lead.temperature, score: lead.score, source: lead.source?.key ?? null, assigned: lead.assignedMembershipId !== null, assignedMembershipId: lead.assignedMembershipId, budgetMax: lead.budgetMaxMinor === null ? null : Number(lead.budgetMaxMinor) / 100, location: lead.location, phone: lead.phone, phoneNorm: lead.phoneNorm },
      event: { type: ev.type, id: ev.id, depth: typeof ev.payload.depth === 'number' ? ev.payload.depth : 0, originAutomationId: typeof ev.payload.originAutomationId === 'string' ? ev.payload.originAutomationId : null, toStage, toTemperature, payload: ev.payload },
      tenant, appointment,
    };
  }

  // ------------------------------------------------------------------ matching
  private triggerMatches(t: AutomationTrigger, ev: { type: string; payload: Record<string, unknown> }): boolean {
    if (t.type !== ev.type) return false;
    if (t.type === 'appointment.upcoming') return ev.payload.hoursBefore === t.hoursBefore;
    if (t.type === 'lead.inactive') return ev.payload.days === t.days;
    return true;
  }

  /** Decide, for one event, which automations run. Every considered automation gets a run row so "why didn't it fire?" has an answer. Returns ids to execute. */
  async matchEvent(tx: TxClient, ev: DomainEvent): Promise<string[]> {
    const candidates = (await tx.automation.findMany({ where: { tenantId: ev.tenantId, enabled: true } })).filter((a) => this.triggerMatches(a.trigger as unknown as AutomationTrigger, ev));
    if (candidates.length === 0) return [];
    const ctx = await this.buildContext(tx, ev.tenantId, ev);
    const toRun: string[] = [];
    for (const a of candidates) {
      let skip: string | null = null;
      if (!ctx) skip = 'no_lead';
      else if (ctx.event.depth >= MAX_CHAIN_DEPTH || ctx.event.originAutomationId === a.id) skip = 'loop_protection';
      else if (!evaluateConditions(a.conditions as unknown as AutomationCondition[], ctx)) skip = 'conditions_not_met';
      else if (a.cooldownMinutes > 0 && ctx.lead.id) {
        const recent = await tx.automationRun.findFirst({ where: { automationId: a.id, leadId: ctx.lead.id, status: { in: ['QUEUED', 'RUNNING', 'SUCCEEDED'] }, createdAt: { gt: new Date(Date.now() - a.cooldownMinutes * 60_000) } }, select: { id: true } });
        if (recent) skip = 'cooldown';
      }
      const id = uuidv7();
      const res = await tx.automationRun.createMany({ data: [{ id, tenantId: ev.tenantId, automationId: a.id, eventId: ev.id, eventType: ev.type, leadId: ctx?.lead.id ?? null, status: skip ? 'SKIPPED' : 'QUEUED', steps: skip ? [{ i: -1, type: 'gate', status: 'skipped', detail: skip }] : [], ...(skip ? { finishedAt: new Date() } : {}) }], skipDuplicates: true });
      if (res.count === 1 && !skip) toRun.push(id);
    }
    return toRun;
  }

  // ------------------------------------------------------------------ execution
  /**
   * Runs one queued run. Safe to call repeatedly (BullMQ retries, duplicate delivery): finished steps are never re-run, sends carry an
   * idempotency key, and a run that is already finished is a no-op. Throws on a retryable failure so the queue retries with backoff;
   * `finalAttempt` turns that failure into a recorded FAILED run plus a manager notification.
   */
  async execute(tenantId: string, runId: string, finalAttempt: boolean): Promise<void> {
    const claim = await this.db.tenantTx({ tenantId }, async (tx) => {
      // Compare-and-set claim: of two workers handed the same run (duplicate job, sweeper race) exactly one proceeds.
      const claimed = await tx.automationRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
      if (claimed.count !== 1) return null;
      const run = await tx.automationRun.findFirstOrThrow({ where: { id: runId }, include: { automation: true } });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.eventId); // synthetic ids (dry runs, tooling) have no outbox row
      const ev = isUuid ? await tx.outboxEvent.findFirst({ where: { id: run.eventId } }) : null;
      const ctx = await this.buildContext(tx, tenantId, { id: run.eventId, type: run.eventType, payload: (ev?.payload as Record<string, unknown>) ?? { leadId: run.leadId } }, run.leadId ?? undefined);
      return { run, ctx };
    });
    if (!claim) return;
    const { run, ctx } = claim;
    const steps = [...(run.steps as unknown as StepResult[])].filter((s) => s.i >= 0);
    const actions = run.automation.actions as unknown as AutomationAction[];
    if (!ctx) { await this.finish(tenantId, runId, 'SKIPPED', steps, 'lead no longer exists'); return; }
    const actor = this.machine(tenantId, run.automationId, ctx.event.depth);
    const created: CreatedNotification[] = [];
    try {
      for (let i = 0; i < actions.length; i++) {
        if (steps.some((s) => s.i === i && s.status !== 'failed')) continue;
        const action = actions[i] as AutomationAction;
        try {
          const detail = await this.runAction(tenantId, actor, ctx, action, `${runId}:${i}`, created);
          steps.push({ i, type: action.type, status: 'done', ...(detail ? { detail } : {}) });
        } catch (e) {
          if (e instanceof StepSkip) steps.push({ i, type: action.type, status: 'skipped', detail: e.message });
          else if (e instanceof HttpException && e.getStatus() < 500) steps.push({ i, type: action.type, status: 'skipped', detail: (e.getResponse() as { message?: string }).message ?? e.message });
          else throw Object.assign(e instanceof Error ? e : new Error(String(e)), { stepIndex: i, stepType: action.type });
        }
        await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { steps: steps as unknown as Prisma.InputJsonValue } }));
      }
      const allSkipped = steps.length > 0 && steps.every((s) => s.status === 'skipped');
      await this.finish(tenantId, runId, allSkipped ? 'SKIPPED' : 'SUCCEEDED', steps, null);
      this.notifications.publish(tenantId, created);
    } catch (e) {
      const err = e as Error & { stepIndex?: number; stepType?: string };
      const message = err.message.slice(0, 300);
      this.log.warn(`Automation run ${runId} failed (attempt, final=${finalAttempt}): ${message}`);
      if (finalAttempt) {
        steps.push({ i: err.stepIndex ?? -1, type: err.stepType ?? 'unknown', status: 'failed', detail: message });
        await this.finish(tenantId, runId, 'FAILED', steps, message);
        await this.notifyFailure(tenantId, run.automation.name, run.automationId, message);
      } else {
        await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { status: 'QUEUED', error: message } }));
        throw e;
      }
    }
  }

  private async finish(tenantId: string, runId: string, status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED', steps: StepResult[], error: string | null): Promise<void> {
    await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { status, steps: steps as unknown as Prisma.InputJsonValue, error, finishedAt: new Date() } }));
  }

  private async notifyFailure(tenantId: string, name: string, automationId: string, error: string): Promise<void> {
    const created = await this.db.tenantTx({ tenantId }, async (tx) => {
      const managers = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: { in: ['owner', 'manager'] } } }, select: { id: true } });
      return this.notifications.create(tx, { tenantId, membershipIds: managers.map((m) => m.id), type: 'automation_failed', title: `Automation "${name}" failed`, body: error.slice(0, 200), link: '/automations', data: { automationId } });
    });
    this.notifications.publish(tenantId, created);
  }

  // ------------------------------------------------------------------ actions
  private async conversationFor(tenantId: string, ctx: EvalContext, wantWhatsapp: boolean): Promise<string> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const existing = await tx.conversation.findFirst({ where: { leadId: ctx.lead.id, ...(wantWhatsapp ? { channel: { type: 'WHATSAPP' } } : {}) }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } });
      if (existing) return existing.id;
      if (!wantWhatsapp) throw new StepSkip('This customer has no conversation yet');
      if (!ctx.lead.phoneNorm) throw new StepSkip('The lead has no phone number');
      const channel = await tx.channel.findFirst({ where: { tenantId, type: 'WHATSAPP', status: 'ACTIVE' }, select: { id: true } });
      if (!channel) throw new StepSkip('No connected WhatsApp number');
      const assistant = await tx.aiAssistant.findUnique({ where: { tenantId }, select: { enabled: true } });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: ctx.lead.id }, select: { assignedMembershipId: true } });
      const id = uuidv7();
      await tx.conversation.createMany({ data: [{ id, tenantId, channelId: channel.id, leadId: ctx.lead.id, externalThreadId: ctx.lead.phoneNorm, assignedMembershipId: lead.assignedMembershipId, mode: assistant?.enabled ? 'AI' : 'HUMAN' }], skipDuplicates: true });
      return (await tx.conversation.findFirstOrThrow({ where: { channelId: channel.id, externalThreadId: ctx.lead.phoneNorm }, select: { id: true } })).id;
    });
  }

  private async runAction(tenantId: string, actor: Actor, ctx: EvalContext, action: AutomationAction, key: string, created: CreatedNotification[]): Promise<string | undefined> {
    switch (action.type) {
      case 'send_whatsapp_template': {
        const conversationId = await this.conversationFor(tenantId, ctx, true);
        const params = action.params.map((p) => render(p, ctx).trim() || '-');
        await this.conversations.sendSystem(tenantId, conversationId, { template: { name: action.template, language: action.language, params }, idempotencyKey: `auto:${key}` });
        return `Template ${action.template}`;
      }
      case 'send_message': {
        const conversationId = await this.conversationFor(tenantId, ctx, false);
        await this.conversations.sendSystem(tenantId, conversationId, { text: render(action.text, ctx), idempotencyKey: `auto:${key}` });
        return 'Message sent';
      }
      case 'assign_round_robin': return this.db.tenantTx({ tenantId }, async (tx) => {
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: ctx.lead.id }, select: { assignedMembershipId: true } });
        if (lead.assignedMembershipId) throw new StepSkip('Lead already has an owner');
        const pick = await this.leastBusy(tx, tenantId);
        if (!pick) throw new StepSkip('No active agents to assign to');
        await this.assign(tx, actor, ctx.lead.id, pick, null);
        return 'Assigned';
      });
      case 'assign_to': return this.db.tenantTx({ tenantId }, async (tx) => {
        const m = await tx.membership.findFirst({ where: { id: action.membershipId, tenantId, status: 'ACTIVE' }, select: { id: true } });
        if (!m) throw new StepSkip('That team member is no longer active');
        await this.assign(tx, actor, ctx.lead.id, m.id, null);
        return 'Assigned';
      });
      case 'create_task': return this.db.tenantTx({ tenantId }, async (tx) => {
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: ctx.lead.id }, select: { assignedMembershipId: true } });
        const assignee = action.assignee === 'lead_owner' ? lead.assignedMembershipId : action.assignee;
        await tx.task.create({ data: { id: uuidv7(), tenantId, leadId: ctx.lead.id, assigneeMembershipId: assignee, title: render(action.title, ctx).slice(0, 200), dueAt: new Date(Date.now() + action.dueInHours * 3600_000), source: 'automation' } });
        return assignee ? 'Task created' : 'Task created (unassigned)';
      });
      case 'notify': return this.db.tenantTx({ tenantId }, async (tx) => {
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: ctx.lead.id }, select: { assignedMembershipId: true } });
        let targets: string[];
        if (action.target === 'lead_owner' && lead.assignedMembershipId) targets = [lead.assignedMembershipId];
        else targets = (await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: { in: ['owner', 'manager'] } } }, select: { id: true } })).map((m) => m.id);
        const made = await this.notifications.create(tx, { tenantId, membershipIds: targets, type: 'hot_lead', title: render(action.title, ctx), ...(action.body ? { body: render(action.body, ctx) } : {}), link: `/leads/${ctx.lead.id}` });
        created.push(...made);
        return `Notified ${made.length}`;
      });
      case 'change_stage': return this.db.tenantTx({ tenantId }, async (tx) => {
        const stage = await tx.pipelineStage.findFirst({ where: { tenantId, key: action.stageKey }, select: { id: true } });
        if (!stage) throw new StepSkip(`Stage "${action.stageKey}" does not exist`);
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: ctx.lead.id }, select: { id: true, stageId: true, assignedMembershipId: true } });
        if (lead.stageId === stage.id) throw new StepSkip('Lead is already at that stage');
        await this.leads.applyStage(tx, actor, lead, { stageId: stage.id });
        return 'Stage changed';
      });
      case 'add_tag': return this.db.tenantTx({ tenantId }, async (tx) => {
        const tag = (await tx.tag.findFirst({ where: { tenantId, name: action.tag } })) ?? (await tx.tag.create({ data: { id: uuidv7(), tenantId, name: action.tag } }));
        await tx.leadTag.createMany({ data: [{ tenantId, leadId: ctx.lead.id, tagId: tag.id }], skipDuplicates: true });
        return 'Tag added';
      });
    }
  }

  async leastBusy(tx: TxClient, tenantId: string): Promise<string | null> {
    const agents = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: { in: ['agent', 'manager'] } } }, select: { id: true, role: { select: { key: true } } } });
    if (!agents.length) return null;
    const load = await tx.lead.groupBy({ by: ['assignedMembershipId'], where: { tenantId, deletedAt: null, stage: { kind: 'OPEN' }, assignedMembershipId: { in: agents.map((x) => x.id) } }, _count: { _all: true } });
    const n = new Map(load.map((x) => [x.assignedMembershipId, x._count._all]));
    const pool = agents.some((x) => x.role.key === 'agent') ? agents.filter((x) => x.role.key === 'agent') : agents;
    return ([...pool].sort((x, y) => (n.get(x.id) ?? 0) - (n.get(y.id) ?? 0) || x.id.localeCompare(y.id))[0] as { id: string }).id;
  }

  private async assign(tx: TxClient, actor: Actor, leadId: string, membershipId: string, reason: string | null): Promise<void> {
    await tx.lead.update({ where: { id: leadId }, data: { assignedMembershipId: membershipId } });
    await tx.conversation.updateMany({ where: { leadId, status: 'OPEN' }, data: { assignedMembershipId: membershipId } });
    await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: actor.tenantId, leadId, type: 'assigned', actorUserId: null, data: { to: membershipId, by: 'automation', ...(reason ? { reason } : {}) } } });
    await this.outbox.emit(tx, actor.tenantId, 'lead.assigned', { leadId, membershipId, byUserId: null, ...originOf(actor) });
  }

  // ------------------------------------------------------------------ dry run
  /**
   * Evaluates an automation against a real lead WITHOUT side effects: nothing is sent, assigned or created. Reads (consent, window, template
   * registry, channel state) are real so the preview also reveals why a step would be skipped.
   */
  async dryRun(tenantId: string, automation: { id: string; name: string; trigger: unknown; conditions: unknown; actions: unknown; cooldownMinutes: number }, leadId: string, appointmentId?: string): Promise<{ runId: string; conditionsMet: boolean; steps: StepResult[]; context: { lead: string; stage: string; temperature: string } }> {
    const trigger = automation.trigger as AutomationTrigger;
    const { ctx, steps, met } = await this.db.tenantTx({ tenantId }, async (tx) => {
      const ev = { id: `dry:${uuidv7()}`, type: trigger.type, payload: { leadId, ...(appointmentId ? { appointmentId } : {}) } };
      const ctx = await this.buildContext(tx, tenantId, ev);
      if (!ctx) return { ctx: null, steps: [] as StepResult[], met: false };
      const met = evaluateConditions(automation.conditions as AutomationCondition[], ctx);
      const steps: StepResult[] = [];
      if (!met) return { ctx, steps, met };
      const actions = automation.actions as AutomationAction[];
      for (let i = 0; i < actions.length; i++) steps.push(await this.preview(tx, tenantId, ctx, actions[i] as AutomationAction, i));
      return { ctx, steps, met };
    });
    if (!ctx) throw new HttpException({ code: 'not_found', message: 'Lead not found' }, 404);
    const runId = uuidv7();
    await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.create({ data: { id: runId, tenantId, automationId: automation.id, eventId: `dry:${runId}`, eventType: trigger.type, leadId, status: 'DRY_RUN', steps: (met ? steps : [{ i: -1, type: 'gate', status: 'skipped', detail: 'conditions_not_met' }]) as unknown as Prisma.InputJsonValue, finishedAt: new Date() } }));
    return { runId, conditionsMet: met, steps, context: { lead: ctx.lead.name, stage: ctx.lead.stage, temperature: ctx.lead.temperature } };
  }

  private async preview(tx: TxClient, tenantId: string, ctx: EvalContext, action: AutomationAction, i: number): Promise<StepResult> {
    const mk = (detail: string, status: StepResult['status'] = 'preview'): StepResult => ({ i, type: action.type, status, detail });
    switch (action.type) {
      case 'send_whatsapp_template': {
        const params = action.params.map((p) => render(p, ctx).trim() || '-');
        if (!ctx.lead.phoneNorm) return mk('Would be skipped: the lead has no phone number', 'skipped');
        const channel = await tx.channel.findFirst({ where: { tenantId, type: 'WHATSAPP', status: 'ACTIVE' }, select: { id: true } });
        if (!channel) return mk('Would be skipped: no connected WhatsApp number', 'skipped');
        const t = await tx.whatsappTemplate.findFirst({ where: { tenantId, name: action.template, language: action.language } });
        if (!t) return mk(`Would be skipped: template "${action.template}" (${action.language}) is not registered`, 'skipped');
        if (params.length !== t.variableCount) return mk(`Would be skipped: template needs ${t.variableCount} value(s), this automation gives ${params.length}`, 'skipped');
        const consent = await tx.consent.findFirst({ where: { leadId: ctx.lead.id, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
        if (!consent) return mk('Would be skipped: no record of the customer opting in to WhatsApp', 'skipped');
        if (consent.status === 'OPTED_OUT') return mk('Would be skipped: the customer opted out of WhatsApp', 'skipped');
        return mk(`Would send template "${action.template}" with: ${params.join(' | ')}`);
      }
      case 'send_message': return mk(`Would send: "${render(action.text, ctx)}" (only if the customer wrote within the last 24 hours)`);
      case 'assign_round_robin': return ctx.lead.assigned ? mk('Would be skipped: lead already has an owner', 'skipped') : mk('Would assign to the least busy agent');
      case 'assign_to': return mk('Would assign to the chosen team member');
      case 'create_task': return mk(`Would create task "${render(action.title, ctx)}" due in ${action.dueInHours}h`);
      case 'notify': return mk(`Would notify ${action.target === 'lead_owner' ? 'the lead owner' : 'managers'}: "${render(action.title, ctx)}"`);
      case 'change_stage': return mk(`Would move the lead to "${action.stageKey}"`);
      case 'add_tag': return mk(`Would add tag "${action.tag}"`);
    }
  }
}
