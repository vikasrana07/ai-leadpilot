import { EntitlementsService } from '../billing/entitlements.service.js';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { effectiveGraph, graphSchema, outEdge, type AutomationAction, type AutomationCondition, type AutomationGraph, type AutomationTrigger, type GraphNode } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { ConversationsService } from '../conversations/conversations.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { metrics } from '../observability/metrics.js';
import { evaluateConditions, MAX_CHAIN_DEPTH, render, type EvalContext } from './automation-logic.js';
import { cursorFrom, endWaitingRuns, evaluateBranch, parseGraph, resumeWaitingRun, safeTrigger, type StepRecord } from './graph-executor.js';
import { NotificationsService, type CreatedNotification } from './notifications.service.js';
import { OutboxService, originOf } from './outbox.service.js';

export type StepResult = StepRecord;
const MAX_NODE_VISITS = 60;
export interface DryRunPathItem { nodeId: string; type: string; outcome: 'yes' | 'no' | 'would_run' | 'would_wait' | 'skipped'; detail?: string | undefined; conditions?: { text: string; pass: boolean }[]; wouldWaitMinutes?: number }
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
    @Inject(EntitlementsService) private readonly ent: EntitlementsService,
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

  /**
   * Waits that end because of this event. A customer message resumes (via the `replied` edge) every run of this lead that is parked on a wait
   * with such an edge; a STOP message instead ends every waiting run for that lead (opt-out always wins). Returns the runs to execute.
   */
  private async handleWaits(tx: TxClient, ev: DomainEvent): Promise<string[]> {
    if (ev.type !== 'message.inbound' || typeof ev.payload.leadId !== 'string') return [];
    const leadId = ev.payload.leadId;
    const waiting = await tx.automationRun.findMany({ where: { tenantId: ev.tenantId, leadId, status: 'WAITING' }, select: { id: true, waitingNode: true, version: { select: { graph: true } } } });
    if (waiting.length === 0) return [];
    const consent = await tx.consent.findFirst({ where: { leadId, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
    if (consent?.status === 'OPTED_OUT') { await endWaitingRuns(tx, { tenantId: ev.tenantId, leadId }, 'The customer opted out'); return []; }
    const resumed: string[] = [];
    for (const r of waiting) {
      if (!r.version || !r.waitingNode || !outEdge(parseGraph(r.version.graph), r.waitingNode, 'replied')) continue;
      if (await resumeWaitingRun(tx, r.id, 'replied')) resumed.push(r.id);
    }
    return resumed;
  }

  /** Every automation runs a pinned, immutable version. Rows that predate versions get theirs created here, lifted from the linear columns. */
  private async ensureVersions(tx: TxClient, rows: { id: string; tenantId: string; activeVersionId: string | null; graphVersion: number; graph: unknown; trigger: unknown; conditions: unknown; actions: unknown; cooldownMinutes: number }[]): Promise<Map<string, { id: string; source: string; graph: AutomationGraph; cooldownMinutes: number }>> {
    const out = new Map<string, { id: string; source: string; graph: AutomationGraph; cooldownMinutes: number }>();
    const known = rows.filter((r) => r.activeVersionId);
    const found = known.length ? await tx.automationVersion.findMany({ where: { id: { in: known.map((r) => r.activeVersionId as string) } } }) : [];
    for (const v of found) { const owner = known.find((r) => r.activeVersionId === v.id); if (owner) out.set(owner.id, { id: v.id, source: v.source, graph: parseGraph(v.graph), cooldownMinutes: v.cooldownMinutes }); }
    for (const r of rows) {
      if (out.has(r.id)) continue;
      const graph = effectiveGraph(r);
      const source = r.graph ? 'graph' : 'linear';
      await tx.automationVersion.createMany({ data: [{ id: uuidv7(), tenantId: r.tenantId, automationId: r.id, version: r.graphVersion, source, graph: graph as unknown as Prisma.InputJsonObject, cooldownMinutes: r.cooldownMinutes }], skipDuplicates: true });
      const v = await tx.automationVersion.findFirstOrThrow({ where: { automationId: r.id, version: r.graphVersion } });
      await tx.automation.updateMany({ where: { id: r.id, activeVersionId: null }, data: { activeVersionId: v.id } });
      out.set(r.id, { id: v.id, source: v.source, graph: parseGraph(v.graph), cooldownMinutes: v.cooldownMinutes });
    }
    return out;
  }

  /** Decide, for one event, which automations run. Every considered automation gets a run row so "why didn't it fire?" has an answer. Returns ids to execute. */
  async matchEvent(tx: TxClient, ev: DomainEvent): Promise<string[]> {
    const resumed = await this.handleWaits(tx, ev);
    const enabled = await tx.automation.findMany({ where: { tenantId: ev.tenantId, enabled: true } });
    const candidates = enabled.filter((a) => {
      const t = safeTrigger(a);
      if (!t) { this.log.error(`Automation ${a.id} (tenant ${ev.tenantId}) has an unreadable definition and was skipped`); return false; }
      return this.triggerMatches(t, ev);
    });
    if (candidates.length === 0) return resumed;
    // A lapsed workspace, or a plan without automations, does not run them (no runs are created, nothing is sent).
    const plan = await this.ent.compute(tx, ev.tenantId);
    if (plan.restricted || !plan.features.automations) return resumed;
    const ctx = await this.buildContext(tx, ev.tenantId, ev);
    const versions = await this.ensureVersions(tx, candidates);
    const toRun: string[] = [...resumed];
    for (const a of candidates) {
      const version = versions.get(a.id) as { id: string; source: string; graph: AutomationGraph; cooldownMinutes: number };
      // A converted linear automation keeps its up-front gate (the single `all` branch); graph-authored ones decide inside the run.
      const gate = version.source === 'linear' ? ((version.graph.nodes.find((n) => n.type === 'branch')?.data as { conditions?: AutomationCondition[] } | undefined)?.conditions ?? []) : [];
      let skip: string | null = null;
      if (!ctx) skip = 'no_lead';
      else if (ctx.event.depth >= MAX_CHAIN_DEPTH || ctx.event.originAutomationId === a.id) skip = 'loop_protection';
      else if (!evaluateConditions(gate, ctx)) skip = 'conditions_not_met';
      // The cooldown belongs to the version the run is pinned to (immutable), not to the live row's mirrored column.
      else if (version.cooldownMinutes > 0 && ctx.lead.id) {
        const recent = await tx.automationRun.findFirst({ where: { automationId: a.id, leadId: ctx.lead.id, status: { in: ['QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED'] }, createdAt: { gt: new Date(Date.now() - version.cooldownMinutes * 60_000) } }, select: { id: true } });
        if (recent) skip = 'cooldown';
      }
      const id = uuidv7();
      const res = await tx.automationRun.createMany({ data: [{ id, tenantId: ev.tenantId, automationId: a.id, versionId: version.id, eventId: ev.id, eventType: ev.type, leadId: ctx?.lead.id ?? null, status: skip ? 'SKIPPED' : 'QUEUED', steps: skip ? [{ i: -1, type: 'gate', status: 'skipped', detail: skip }] : [], ...(skip ? { finishedAt: new Date() } : {}) }], skipDuplicates: true });
      if (res.count === 1 && !skip) toRun.push(id);
    }
    return toRun;
  }

  // ------------------------------------------------------------------ execution
  /**
   * Runs one queued run. Safe to call repeatedly (BullMQ retries, duplicate delivery, resumption after a wait): the position in the graph is
   * rebuilt from the recorded steps, so finished nodes are never re-run and a recorded branch decision is never re-decided; sends carry an
   * idempotency key; a run that is already finished is a no-op. Throws on a retryable failure so the queue retries with backoff;
   * `finalAttempt` turns that failure into a recorded FAILED run plus a manager notification. A wait node parks the run as WAITING
   * (the scanner or a customer reply puts it back in the queue). The run executes the version it was created with, never later edits.
   */
  async execute(tenantId: string, runId: string, finalAttempt: boolean): Promise<void> {
    const claim = await this.db.tenantTx({ tenantId }, async (tx) => {
      // Compare-and-set claim: of two workers handed the same run (duplicate job, sweeper race) exactly one proceeds.
      const claimed = await tx.automationRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
      if (claimed.count !== 1) return null;
      const run = await tx.automationRun.findFirstOrThrow({ where: { id: runId }, include: { automation: true, version: true } });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.eventId); // synthetic ids (dry runs, tooling) have no outbox row
      const ev = isUuid ? await tx.outboxEvent.findFirst({ where: { id: run.eventId } }) : null;
      const ctx = await this.buildContext(tx, tenantId, { id: run.eventId, type: run.eventType, payload: (ev?.payload as Record<string, unknown>) ?? { leadId: run.leadId } }, run.leadId ?? undefined);
      const resumed = (run.steps as unknown as StepRecord[]).some((s) => s.type === 'wait' && s.status !== 'waiting');
      let stop: string | null = null;
      if (resumed && ctx) {
        // Time has passed: the world may have changed while the run waited. Re-check before doing anything.
        const plan = await this.ent.compute(tx, tenantId);
        const consent = await tx.consent.findFirst({ where: { leadId: ctx.lead.id, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
        if (!run.automation.enabled) stop = 'The automation was turned off while this run waited';
        else if (plan.restricted || !plan.features.automations) stop = 'The plan no longer includes automations';
        else if (consent?.status === 'OPTED_OUT') stop = 'The customer opted out';
      }
      return { run, ctx, stop };
    });
    if (!claim) return;
    const { run, ctx, stop } = claim;
    const steps = [...(run.steps as unknown as StepRecord[])].filter((s) => s.i >= 0);
    if (!ctx) { await this.finish(tenantId, runId, 'SKIPPED', steps, 'lead no longer exists'); return; }
    if (stop) { await this.finish(tenantId, runId, 'SKIPPED', steps.map((s) => (s.status === 'waiting' ? { ...s, status: 'skipped' as const, detail: stop } : s)), stop); return; }
    // A run created before versions existed (or by tooling) executes the automation's linear columns as a graph.
    const linearSource = run.version ? run.version.source === 'linear' : !run.automation.graph;
    const graph = run.version ? parseGraph(run.version.graph) : effectiveGraph(run.automation);
    const actor = this.machine(tenantId, run.automationId, ctx.event.depth);
    const created: CreatedNotification[] = [];
    let current: { id: string; type: string } | null = null;
    try {
      for (let visits = 0; visits < MAX_NODE_VISITS; visits++) {
        const cur = cursorFrom(graph, steps, linearSource);
        if (cur.kind === 'end') break;
        if (cur.kind === 'waiting') { await this.park(tenantId, runId, steps, cur.step.resumeAt ? new Date(cur.step.resumeAt) : new Date()); return; }
        const node = cur.node; current = node;
        const prior = steps.find((s) => s.status === 'failed' && s.nodeId === node.id);
        const i = prior?.i ?? steps.filter((s) => s.i >= 0 && s.status !== 'failed').length;
        if (node.type === 'action') {
          try {
            const detail = await this.runAction(tenantId, actor, ctx, node.data, `${runId}:${node.id}`, created);
            steps.push({ i, nodeId: node.id, type: node.data.type, status: 'done', ...(detail ? { detail } : {}) });
          } catch (e) {
            if (e instanceof StepSkip) steps.push({ i, nodeId: node.id, type: node.data.type, status: 'skipped', detail: e.message });
            else if (e instanceof HttpException && e.getStatus() < 500) steps.push({ i, nodeId: node.id, type: node.data.type, status: 'skipped', detail: (e.getResponse() as { message?: string }).message ?? e.message });
            else throw Object.assign(e instanceof Error ? e : new Error(String(e)), { stepIndex: i, stepType: node.data.type, nodeId: node.id });
          }
        } else if (node.type === 'branch') {
          const r = evaluateBranch(node.data, ctx);
          steps.push({ i, nodeId: node.id, type: 'branch', status: 'done', branch: r.pass ? 'yes' : 'no', detail: r.pass ? 'Condition met' : 'Condition not met', conditions: r.conditions });
        } else if (node.type === 'wait') {
          const resumeAt = new Date(Date.now() + node.data.minutes * 60_000);
          steps.push({ i, nodeId: node.id, type: 'wait', status: 'waiting', resumeAt: resumeAt.toISOString(), at: new Date().toISOString(), detail: `Waiting until ${resumeAt.toISOString()}` });
          await this.park(tenantId, runId, steps, resumeAt, node.id);
          return;
        } else break;
        await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { steps: steps as unknown as Prisma.InputJsonValue } }));
      }
      const acted = steps.filter((s) => s.type !== 'branch' && s.type !== 'wait');
      const allSkipped = acted.length > 0 && acted.every((s) => s.status === 'skipped');
      await this.finish(tenantId, runId, allSkipped ? 'SKIPPED' : 'SUCCEEDED', steps, null);
      this.notifications.publish(tenantId, created);
    } catch (e) {
      const err = e as Error & { stepIndex?: number; stepType?: string; nodeId?: string };
      const message = err.message.slice(0, 300);
      this.log.warn(`Automation run ${runId} failed (attempt, final=${finalAttempt}): ${message}`);
      if (finalAttempt) {
        steps.push({ i: err.stepIndex ?? -1, ...((err.nodeId ?? current?.id) ? { nodeId: (err.nodeId ?? current?.id) as string } : {}), type: err.stepType ?? 'unknown', status: 'failed', detail: message });
        // Notify before the status flips, so anything that observes FAILED can rely on the managers having been told.
        await this.notifyFailure(tenantId, run.automation.name, run.automationId, message).catch((n: unknown) => this.log.error(`Failure notice for run ${runId} not sent: ${n instanceof Error ? n.message : String(n)}`));
        await this.finish(tenantId, runId, 'FAILED', steps, message);
      } else {
        await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { status: 'QUEUED', error: message, steps: steps as unknown as Prisma.InputJsonValue } }));
        throw e;
      }
    }
  }

  /** Parks the run on a wait node: persisted steps, WAITING status and the time to resume. The worker is released; nothing sleeps. */
  private async park(tenantId: string, runId: string, steps: StepRecord[], resumeAt: Date, nodeId?: string): Promise<void> {
    const waiting = [...steps].reverse().find((s) => s.status === 'waiting');
    await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { status: 'WAITING', resumeAt, waitingNode: nodeId ?? waiting?.nodeId ?? null, steps: steps as unknown as Prisma.InputJsonValue } }));
  }

  private async finish(tenantId: string, runId: string, status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED', steps: StepResult[], error: string | null): Promise<void> {
    metrics.job('automation', status === 'SUCCEEDED' ? 'ok' : status === 'FAILED' ? 'failed' : 'skipped');
    await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.update({ where: { id: runId }, data: { status, steps: steps as unknown as Prisma.InputJsonValue, error, finishedAt: new Date(), resumeAt: null, waitingNode: null } }));
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
   * registry, channel state) are real so the preview also reveals why a step would be skipped. Walks the graph (the stored one, or an unsaved
   * `draft`): branches are evaluated against the lead, waits are not slept (they show as "would wait") and the timeout path is followed.
   * `path` lists every node visited; `steps`, `conditionsMet` and `context` keep the shape the linear dry run always had.
   */
  async dryRun(tenantId: string, automation: { id: string; name: string; trigger: unknown; conditions: unknown; actions: unknown; graph?: unknown; cooldownMinutes: number }, leadId: string, appointmentId?: string, draft?: unknown): Promise<{ runId: string; conditionsMet: boolean; steps: StepResult[]; path: DryRunPathItem[]; context: { lead: string; stage: string; temperature: string } }> {
    const graph: AutomationGraph = draft ? graphSchema.parse(draft) : effectiveGraph(automation);
    const linearSource = !draft && !automation.graph;
    const triggerNode = graph.nodes.find((n) => n.type === 'trigger') as Extract<GraphNode, { type: 'trigger' }>;
    const trigger = triggerNode.data;
    const { ctx, steps, path, met } = await this.db.tenantTx({ tenantId }, async (tx) => {
      const ev = { id: `dry:${uuidv7()}`, type: trigger.type, payload: { leadId, ...(appointmentId ? { appointmentId } : {}) } };
      const ctx = await this.buildContext(tx, tenantId, ev);
      const steps: StepResult[] = []; const path: DryRunPathItem[] = [];
      if (!ctx) return { ctx: null, steps, path, met: false };
      let met = true;
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      let id = outEdge(graph, triggerNode.id, 'next')?.to;
      for (let guard = 0; id && guard < MAX_NODE_VISITS; guard++) {
        const node = byId.get(id); if (!node) break;
        if (node.type === 'branch') {
          const r = evaluateBranch(node.data, ctx);
          path.push({ nodeId: node.id, type: 'branch', outcome: r.pass ? 'yes' : 'no', conditions: r.conditions });
          if (!linearSource) steps.push({ i: steps.length, nodeId: node.id, type: 'branch', status: 'preview', branch: r.pass ? 'yes' : 'no', detail: r.pass ? 'Condition met' : 'Condition not met', conditions: r.conditions });
          if (!r.pass && linearSource) met = false;
          id = outEdge(graph, node.id, r.pass ? 'yes' : 'no')?.to;
        } else if (node.type === 'action') {
          const step = await this.preview(tx, tenantId, ctx, node.data, steps.length);
          steps.push({ ...step, nodeId: node.id });
          path.push({ nodeId: node.id, type: node.data.type, outcome: step.status === 'skipped' ? 'skipped' : 'would_run', detail: step.detail });
          id = outEdge(graph, node.id, 'next')?.to;
        } else if (node.type === 'wait') {
          const detail = `Would wait ${node.data.minutes} minute${node.data.minutes === 1 ? '' : 's'} (follows the "no reply" path${outEdge(graph, node.id, 'replied') ? '; a reply would take the other path' : ''})`;
          steps.push({ i: steps.length, nodeId: node.id, type: 'wait', status: 'preview', detail });
          path.push({ nodeId: node.id, type: 'wait', outcome: 'would_wait', wouldWaitMinutes: node.data.minutes, detail });
          id = outEdge(graph, node.id, 'timeout', 'next')?.to;
        } else break;
        if (!met) break;
      }
      return { ctx, steps, path, met };
    });
    if (!ctx) throw new HttpException({ code: 'not_found', message: 'Lead not found' }, 404);
    const runId = uuidv7();
    const stored = met ? steps : [{ i: -1, type: 'gate', status: 'skipped', detail: 'conditions_not_met' }];
    await this.db.tenantTx({ tenantId }, (tx) => tx.automationRun.create({ data: { id: runId, tenantId, automationId: automation.id, eventId: `dry:${runId}`, eventType: trigger.type, leadId, status: 'DRY_RUN', steps: stored as unknown as Prisma.InputJsonValue, finishedAt: new Date() } }));
    return { runId, conditionsMet: met, steps: met ? steps : [], path, context: { lead: ctx.lead.name, stage: ctx.lead.stage, temperature: ctx.lead.temperature } };
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
        if (t.approvalStatus && t.approvalStatus !== 'APPROVED') return mk(`Would be skipped: WhatsApp has not approved template "${action.template}" (status: ${t.approvalStatus.toLowerCase()})`, 'skipped');
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
