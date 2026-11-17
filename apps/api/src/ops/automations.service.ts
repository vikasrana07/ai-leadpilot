import { EntitlementsService } from '../billing/entitlements.service.js';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TxClient } from '@leadpilot/database';
import { actionSchema, automationInputSchema, graphErrors, linearToGraph, summarizeGraph, validateGraph, effectiveGraph, type AutomationAction, type AutomationGraph, type AutomationInput, type GraphIssue, type automationGraphInputSchema } from '@leadpilot/validation';
import type { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { AutomationEngine } from './automation-engine.js';
import { AUTOMATION_TEMPLATES } from './automation-templates.js';
import { endWaitingRuns, parseGraph } from './graph-executor.js';

type Row = Prisma.AutomationGetPayload<object>;
export type GraphWriteInput = z.infer<typeof automationGraphInputSchema>;
export type WriteInput = AutomationInput | GraphWriteInput;

/** Stable JSON (sorted keys): Postgres jsonb does not keep key order, so definitions are compared canonically. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
const actionsOf = (g: AutomationGraph): AutomationAction[] => g.nodes.flatMap((n) => (n.type === 'action' ? [n.data] : []));
const triggerOf = (g: AutomationGraph) => (g.nodes.find((n) => n.type === 'trigger') as Extract<AutomationGraph['nodes'][number], { type: 'trigger' }>).data;

interface Prepared { source: 'linear' | 'graph'; graph: AutomationGraph | null; versionGraph: AutomationGraph; trigger: unknown; conditions: unknown; actions: AutomationAction[] }

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
      const graph = effectiveGraph(r);
      const needs = [...new Set((r.actions as unknown as AutomationAction[]).flatMap((a) => (a.type === 'send_whatsapp_template' ? [a.template] : [])))];
      return {
        id: r.id, templateKey: r.templateKey, name: r.name, description: r.description, enabled: r.enabled, trigger: r.trigger, conditions: r.conditions, actions: r.actions, cooldownMinutes: r.cooldownMinutes,
        graph, version: r.graphVersion, summary: summarizeGraph(graph), graphAuthored: r.graph !== null,
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
      return { items: AUTOMATION_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, category: t.category, trigger: t.trigger, actions: t.actions, graph: linearToGraph(t), summary: summarizeGraph(linearToGraph(t)), requiresWhatsappTemplates: t.requiresWhatsappTemplates, installed: installed.has(t.key) })) };
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

  /** Assignee/stage references inside a graph, reported per node (the editor shows them in place). */
  private async refIssues(tx: TxClient, a: Actor, g: AutomationGraph): Promise<GraphIssue[]> {
    const out: GraphIssue[] = [];
    for (const n of g.nodes) {
      if (n.type !== 'action') continue;
      const act = n.data;
      if (act.type === 'assign_to' || (act.type === 'create_task' && act.assignee !== 'lead_owner')) {
        const id = act.type === 'assign_to' ? act.membershipId : (act.assignee as string);
        if (!(await tx.membership.findFirst({ where: { id, tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true } }))) out.push({ severity: 'error', code: 'invalid_assignee', message: 'This step names a team member who is not active', nodeId: n.id });
      }
      if (act.type === 'change_stage' && !(await tx.pipelineStage.findFirst({ where: { tenantId: a.tenantId, key: act.stageKey }, select: { id: true } }))) out.push({ severity: 'error', code: 'invalid_stage', message: `Stage "${act.stageKey}" does not exist`, nodeId: n.id });
    }
    return out;
  }

  /** Validates a write (legacy linear body or graph body) and returns what to store. Throws 400 with the issue list. */
  private async prepare(tx: TxClient, a: Actor, input: WriteInput): Promise<Prepared> {
    if ('graph' in input) {
      const issues = validateGraph(input.graph);
      if (graphErrors(issues).length) throw new BadRequestException({ code: 'invalid_graph', message: 'The automation has problems to fix', details: issues });
      const g = parseGraph(input.graph);
      const refs = await this.refIssues(tx, a, g);
      if (refs.length) throw new BadRequestException({ code: 'invalid_graph', message: refs[0]?.message ?? 'Invalid automation', details: [...issues, ...refs] });
      return { source: 'graph', graph: g, versionGraph: g, trigger: triggerOf(g), conditions: [], actions: actionsOf(g) };
    }
    await this.validateActions(tx, a, input.actions);
    const g = linearToGraph(input);
    const issues = validateGraph(g);
    if (graphErrors(issues).length) throw new BadRequestException({ code: 'invalid_graph', message: 'The automation has problems to fix', details: issues });
    return { source: 'linear', graph: null, versionGraph: g, trigger: input.trigger, conditions: input.conditions, actions: input.actions };
  }

  /** No writes: structural issues plus assignee/stage references, and a plain-English summary when it is valid. */
  async validate(a: Actor, graph: unknown) {
    const issues = validateGraph(graph);
    if (graphErrors(issues).length) return { ok: false, issues, summary: [] as string[] };
    const g = parseGraph(graph);
    const all = [...issues, ...(await this.tx(a, (tx) => this.refIssues(tx, a, g)))];
    const ok = graphErrors(all).length === 0;
    return { ok, issues: all, summary: ok ? summarizeGraph(g) : [] };
  }

  async create(a: Actor, input: WriteInput, templateKey: string | null = null) {
    const row = await this.tx(a, async (tx) => {
      const p = await this.prepare(tx, a, input);
      const id = uuidv7(); const versionId = uuidv7();
      const r = await tx.automation.create({ data: { id, tenantId: a.tenantId, templateKey, name: input.name, description: input.description ?? null, enabled: false, trigger: p.trigger as Prisma.InputJsonObject, conditions: p.conditions as unknown as Prisma.InputJsonArray, actions: p.actions as unknown as Prisma.InputJsonArray, ...(p.graph ? { graph: p.graph as unknown as Prisma.InputJsonObject } : {}), graphVersion: 1, activeVersionId: versionId, cooldownMinutes: input.cooldownMinutes, createdBy: a.userId } });
      await tx.automationVersion.create({ data: { id: versionId, tenantId: a.tenantId, automationId: id, version: 1, source: p.source, graph: p.versionGraph as unknown as Prisma.InputJsonObject, cooldownMinutes: input.cooldownMinutes, createdBy: a.userId } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'automation.created', resourceType: 'automation', resourceId: r.id, metadata: { templateKey, version: 1, graph: p.source === 'graph' }, ...(a.requestId ? { requestId: a.requestId } : {}) });
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

  async update(a: Actor, id: string, input: WriteInput) {
    await this.tx(a, async (tx) => {
      const cur = await tx.automation.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      if (input.expectedVersion !== undefined && input.expectedVersion !== cur.graphVersion) throw new ConflictException({ code: 'version_conflict', message: 'Someone else saved a newer version. Reload to see it before saving again.', details: { currentVersion: cur.graphVersion } });
      const p = await this.prepare(tx, a, input);
      // A new version only when the definition (or cooldown) actually changed; renaming alone does not fork history.
      const changed = canon(p.versionGraph) !== canon(effectiveGraph(cur)) || input.cooldownMinutes !== cur.cooldownMinutes || (p.source === 'graph') !== (cur.graph !== null);
      const next = changed ? cur.graphVersion + 1 : cur.graphVersion;
      const versionId = changed ? uuidv7() : cur.activeVersionId;
      // Compare-and-set on the version we read: two saves racing from the same version cannot both win.
      const won = await tx.automation.updateMany({ where: { id, tenantId: a.tenantId, graphVersion: cur.graphVersion }, data: { name: input.name, description: input.description ?? null, trigger: p.trigger as Prisma.InputJsonObject, conditions: p.conditions as unknown as Prisma.InputJsonArray, actions: p.actions as unknown as Prisma.InputJsonArray, graph: p.graph ? (p.graph as unknown as Prisma.InputJsonObject) : Prisma.DbNull, cooldownMinutes: input.cooldownMinutes, graphVersion: next, activeVersionId: versionId } });
      if (won.count !== 1) throw new ConflictException({ code: 'version_conflict', message: 'Someone else saved a newer version. Reload to see it before saving again.' });
      if (changed) await tx.automationVersion.create({ data: { id: versionId as string, tenantId: a.tenantId, automationId: id, version: next, source: p.source, graph: p.versionGraph as unknown as Prisma.InputJsonObject, cooldownMinutes: input.cooldownMinutes, createdBy: a.userId } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'automation.updated', resourceType: 'automation', resourceId: id, metadata: { version: next, newVersion: changed }, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
    return this.get(a, id);
  }

  async versions(a: Actor, id: string) {
    return this.tx(a, async (tx) => {
      if (!(await tx.automation.findFirst({ where: { id, tenantId: a.tenantId }, select: { id: true } }))) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      const rows = await tx.automationVersion.findMany({ where: { automationId: id }, orderBy: { version: 'desc' }, take: 50 });
      return { items: rows.map((v) => { const g = parseGraph(v.graph); return { id: v.id, version: v.version, source: v.source, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy, cooldownMinutes: v.cooldownMinutes, graph: g, summary: summarizeGraph(g) }; }) };
    });
  }

  async setEnabled(a: Actor, id: string, enabled: boolean) {
    await this.tx(a, async (tx) => {
      const cur = await tx.automation.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
      // Re-validate on enable: stages/members referenced earlier may have been removed.
      if (enabled && !cur.enabled) await this.ent.assertCanAdd(a.tenantId, 'active_automations', 'active automations');
      if (enabled) {
        actionSchema.array().parse(cur.actions);
        const g = effectiveGraph(cur);
        const issues = [...validateGraph(g), ...(await this.refIssues(tx, a, g))];
        if (graphErrors(issues).length) throw new BadRequestException({ code: 'invalid_graph', message: 'Fix the problems in this automation before turning it on', details: issues });
        await this.validateActions(tx, a, cur.actions as unknown as AutomationAction[]);
      }
      await tx.automation.update({ where: { id }, data: { enabled } });
      // Turning it off ends runs parked on a wait: a disabled automation must not wake up later and message people.
      const ended = enabled ? 0 : await endWaitingRuns(tx, { tenantId: a.tenantId, automationId: id }, 'The automation was turned off');
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: enabled ? 'automation.enabled' : 'automation.disabled', resourceType: 'automation', resourceId: id, metadata: ended ? { waitingRunsEnded: ended } : {}, ...(a.requestId ? { requestId: a.requestId } : {}) });
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

  async dryRun(a: Actor, id: string, leadId: string, appointmentId?: string, draft?: unknown) {
    const automation = await this.tx(a, (tx) => tx.automation.findFirst({ where: { id, tenantId: a.tenantId } }));
    if (!automation) throw new NotFoundException({ code: 'not_found', message: 'Automation not found' });
    if (draft !== undefined) {
      const issues = validateGraph(draft);
      if (graphErrors(issues).length) throw new BadRequestException({ code: 'invalid_graph', message: 'The draft has problems to fix', details: issues });
    }
    return this.engine.dryRun(a.tenantId, automation, leadId, appointmentId, draft);
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
        items: page.map((r) => ({ id: r.id, automationId: r.automationId, automationName: r.automation.name, eventType: r.eventType, leadId: r.leadId, leadName: r.leadId ? L.get(r.leadId) ?? null : null, status: r.status, attempts: r.attempts, error: r.error, steps: r.steps, versionId: r.versionId, resumeAt: r.resumeAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })),
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
