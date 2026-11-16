import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { BuyingTimeline, Prisma, TxClient } from '@leadpilot/database';
import { TIMELINES, UNAVAILABLE_AI_TOOLS } from '@leadpilot/validation';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { toMinor } from '../common/money.js';
import { DbService } from '../db/db.module.js';
import { PropertiesService } from '../properties/properties.module.js';
import { RealtimeService } from '../realtime/realtime.module.js';
import type { ToolDefinition } from './llm.js';
import { ScoringService } from './scoring/scoring.service.js';
import { isOpenNow, describeHours, type WorkingHours } from './working-hours.js';

/** Everything a tool may know. Tenant, conversation and lead come from the SERVER, never from model output. */
export interface ToolContext {
  tenantId: string; conversationId: string; leadId: string; runId: string;
  allowed: ReadonlySet<string>;
  assistant: { workingHours: WorkingHours | null; name: string; businessIdentity: string; businessDescription: string; languages: string[] };
  tenant: { name: string; email: string; phone: string | null; website: string | null; address: string | null; timezone: string; currency: string };
}
export interface ToolOutcome { ok: boolean; result: Record<string, unknown> }

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });
/** OpenAI strict mode: every property listed in `required`, additionalProperties false, optional values expressed as nullable. */
const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const rupees = z.number().finite().min(0).max(1e11);
const str = (n: number) => z.string().trim().min(1).max(n);

const inputs = {
  get_business_info: z.object({}).strict(),
  search_properties: z.object({ location: str(100).nullable(), bedrooms: z.number().int().min(0).max(20).nullable(), minPrice: rupees.nullable(), maxPrice: rupees.nullable(), propertyType: str(60).nullable() }).strict(),
  get_lead_details: z.object({}).strict(),
  update_lead: z.object({
    budgetMin: rupees.nullable(), budgetMax: rupees.nullable(), location: str(200).nullable(), propertyType: str(80).nullable(), requirements: str(600).nullable(),
    buyingTimeline: z.enum(TIMELINES).nullable(), siteVisitRequested: z.boolean().nullable(), name: str(120).nullable(),
  }).strict(),
  calculate_lead_score: z.object({}).strict(),
  assign_agent: z.object({ reason: str(200) }).strict(),
  create_followup: z.object({ inHours: z.number().int().min(1).max(720), note: str(300) }).strict(),
  handover_to_human: z.object({ reason: str(300) }).strict(),
} as const;
export type ToolName = keyof typeof inputs | 'check_availability' | 'create_appointment';

export const TOOL_DEFINITIONS: Record<keyof typeof inputs, ToolDefinition> = {
  get_business_info: { name: 'get_business_info', description: 'Get the business name, description, contact details and team working hours. Use before answering questions about the business.', parameters: schema({}) },
  search_properties: { name: 'search_properties', description: 'Search the real property inventory for AVAILABLE units. Use for any question about what is available or what something costs. Prices are in rupees. Pass null for filters the customer did not mention.', parameters: schema({ location: nullable('string'), bedrooms: nullable('integer'), minPrice: nullable('number'), maxPrice: nullable('number'), propertyType: nullable('string') }) },
  get_lead_details: { name: 'get_lead_details', description: 'Get what is already known about the customer you are talking to (budget, area, timeline, etc.).', parameters: schema({}) },
  update_lead: { name: 'update_lead', description: 'Save information the customer has shared. Only include values they actually stated; use null for everything else. Budgets are in rupees. Never guess.', parameters: schema({ budgetMin: nullable('number'), budgetMax: nullable('number'), location: nullable('string'), propertyType: nullable('string'), requirements: nullable('string'), buyingTimeline: nullable('string', { enum: [...TIMELINES, null] }), siteVisitRequested: nullable('boolean'), name: nullable('string') }) },
  calculate_lead_score: { name: 'calculate_lead_score', description: 'Recalculate the lead score from saved information and see which signals are still unknown.', parameters: schema({}) },
  assign_agent: { name: 'assign_agent', description: 'Assign this customer to the least busy sales agent so a person follows up.', parameters: schema({ reason: { type: 'string' } }) },
  create_followup: { name: 'create_followup', description: 'Schedule a follow-up reminder for the team after a number of hours.', parameters: schema({ inHours: { type: 'integer' }, note: { type: 'string' } }) },
  handover_to_human: { name: 'handover_to_human', description: 'Hand the conversation to a person. Use when the customer asks for one, wants to negotiate or complain, or you cannot answer from facts.', parameters: schema({ reason: { type: 'string' } }) },
};

/** Tools the model may be shown, i.e. enabled for this tenant AND implemented. */
export function modelTools(allowed: ReadonlySet<string>): ToolDefinition[] {
  return (Object.keys(TOOL_DEFINITIONS) as (keyof typeof TOOL_DEFINITIONS)[]).filter((n) => allowed.has(n) && !(UNAVAILABLE_AI_TOOLS as readonly string[]).includes(n)).map((n) => TOOL_DEFINITIONS[n]);
}

const money = (rupee: number): string => (rupee >= 1e7 ? `₹${Math.round((rupee / 1e7) * 100) / 100} Cr` : rupee >= 1e5 ? `₹${Math.round((rupee / 1e5) * 100) / 100} L` : `₹${rupee.toLocaleString('en-IN')}`);

@Injectable()
export class ToolRunner {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ScoringService) private readonly scoring: ScoringService,
    @Inject(PropertiesService) private readonly properties: PropertiesService,
    @Inject(RealtimeService) private readonly rt: RealtimeService,
  ) {}

  /**
   * The only way the model can act. Order of checks: known tool → enabled for this tenant → arguments validate against a strict
   * schema (unknown keys such as a `tenantId` or `leadId` are REJECTED) → idempotency (a retried identical call returns the stored
   * result) → execution inside a tenant-scoped transaction → evidence row + audit entry. Failures are returned to the model as a
   * result, never thrown, so one bad call cannot crash the turn.
   */
  async execute(ctx: ToolContext, name: string, rawArgs: string): Promise<ToolOutcome> {
    const known = Object.keys(inputs).includes(name) || (UNAVAILABLE_AI_TOOLS as readonly string[]).includes(name);
    if (!known) return { ok: false, result: { error: 'unknown_tool' } };
    if (!ctx.allowed.has(name)) return { ok: false, result: { error: 'tool_not_enabled' } };
    if ((UNAVAILABLE_AI_TOOLS as readonly string[]).includes(name)) return { ok: false, result: { error: 'scheduling_unavailable', message: 'Scheduling is not available. Tell the customer a team member will confirm a time.' } };
    let json: unknown;
    try { json = JSON.parse(rawArgs || '{}'); } catch { return { ok: false, result: { error: 'invalid_json' } }; }
    const parsed = inputs[name as keyof typeof inputs].safeParse(json);
    if (!parsed.success) return { ok: false, result: { error: 'invalid_arguments', issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`) } };

    const key = `${ctx.runId}:${name}:${createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex').slice(0, 24)}`;
    const prior = await this.db.tenantTx({ tenantId: ctx.tenantId }, (tx) => tx.aiToolExecution.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: key } } }));
    if (prior) return { ok: prior.status === 'ok', result: prior.result as Record<string, unknown> };

    let outcome: ToolOutcome;
    try { outcome = await this.run(ctx, name as keyof typeof inputs, parsed.data as never); }
    catch (e) { outcome = { ok: false, result: { error: 'tool_failed', message: e instanceof Error ? e.message.slice(0, 120) : 'failed' } }; }

    await this.db.tenantTx({ tenantId: ctx.tenantId }, async (tx) => {
      await tx.aiToolExecution.createMany({ data: [{ id: uuidv7(), tenantId: ctx.tenantId, runId: ctx.runId, tool: name, input: parsed.data as Prisma.InputJsonValue, result: outcome.result as Prisma.InputJsonValue, status: outcome.ok ? 'ok' : 'error', idempotencyKey: key }], skipDuplicates: true });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: null, action: 'ai.tool_executed', resourceType: 'lead', resourceId: ctx.leadId, metadata: { tool: name, ok: outcome.ok, runId: ctx.runId } });
    });
    return outcome;
  }

  private tx<T>(ctx: ToolContext, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: ctx.tenantId }, fn); }

  private async run(ctx: ToolContext, name: keyof typeof inputs, a: never): Promise<ToolOutcome> {
    switch (name) {
      case 'get_business_info': {
        const hours = ctx.assistant.workingHours;
        return { ok: true, result: { name: ctx.assistant.businessIdentity || ctx.tenant.name, description: ctx.assistant.businessDescription || null, email: ctx.tenant.email, phone: ctx.tenant.phone, website: ctx.tenant.website, address: ctx.tenant.address, workingHours: describeHours(hours), teamAvailableNow: isOpenNow(hours, ctx.tenant.timezone), currency: ctx.tenant.currency } };
      }
      case 'search_properties': {
        const f = a as z.infer<typeof inputs.search_properties>;
        const where = this.properties.where(ctx.tenantId, { status: 'AVAILABLE', ...(f.location ? { location: f.location } : {}), ...(f.bedrooms !== null ? { bedrooms: f.bedrooms } : {}), ...(f.minPrice !== null ? { minPrice: f.minPrice } : {}), ...(f.maxPrice !== null ? { maxPrice: f.maxPrice } : {}), ...(f.propertyType ? { propertyType: f.propertyType } : {}) });
        const rows = await this.tx(ctx, (tx) => tx.property.findMany({ where, orderBy: [{ priceMinor: 'asc' }, { id: 'asc' }], take: 5 }));
        return { ok: true, result: { count: rows.length, asOf: new Date().toISOString(), properties: rows.map((p) => ({ title: p.title, project: p.project, unit: p.unitLabel, type: p.propertyType, bedrooms: p.bedrooms, areaSqft: p.areaSqft, location: p.location, status: p.status, price: Number(p.priceMinor) / 100, priceDisplay: money(Number(p.priceMinor) / 100) })) } };
      }
      case 'get_lead_details': {
        const l = await this.tx(ctx, (tx) => tx.lead.findUniqueOrThrow({ where: { id: ctx.leadId } }));
        return { ok: true, result: { name: l.name, budgetMin: l.budgetMinMinor === null ? null : Number(l.budgetMinMinor) / 100, budgetMax: l.budgetMaxMinor === null ? null : Number(l.budgetMaxMinor) / 100, location: l.location, propertyType: l.propertyType, requirements: l.requirements, buyingTimeline: l.buyingTimeline, siteVisitRequested: l.siteVisitRequested, score: l.score, temperature: l.temperature } };
      }
      case 'update_lead': {
        const f = a as z.infer<typeof inputs.update_lead>;
        const result = await this.tx(ctx, async (tx) => {
          const cur = await tx.lead.findUniqueOrThrow({ where: { id: ctx.leadId } });
          const data: Prisma.LeadUncheckedUpdateInput = {}; const changed: string[] = [];
          if (f.budgetMin !== null) { data.budgetMinMinor = toMinor(f.budgetMin); changed.push('budgetMin'); }
          if (f.budgetMax !== null) { data.budgetMaxMinor = toMinor(f.budgetMax); changed.push('budgetMax'); }
          const lo = f.budgetMin ?? (cur.budgetMinMinor === null ? null : Number(cur.budgetMinMinor) / 100); const hi = f.budgetMax ?? (cur.budgetMaxMinor === null ? null : Number(cur.budgetMaxMinor) / 100);
          if (lo !== null && hi !== null && lo > hi) throw new Error('minimum budget cannot exceed maximum');
          if (f.location !== null) { data.location = f.location; changed.push('location'); }
          if (f.propertyType !== null) { data.propertyType = f.propertyType; changed.push('propertyType'); }
          if (f.requirements !== null) { data.requirements = f.requirements; changed.push('requirements'); }
          if (f.buyingTimeline !== null) { data.buyingTimeline = f.buyingTimeline as BuyingTimeline; changed.push('buyingTimeline'); }
          if (f.siteVisitRequested === true) { data.siteVisitRequested = true; changed.push('siteVisitRequested'); }
          if (f.name !== null && /^(new contact|website visitor|\+?\d[\d\s]+)$/i.test(cur.name)) { data.name = f.name; changed.push('name'); } // only replace placeholder names
          if (changed.length) {
            await tx.lead.update({ where: { id: ctx.leadId }, data });
            await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, leadId: ctx.leadId, type: 'ai_updated', actorUserId: null, data: { fields: changed } } });
          }
          const scored = await this.scoring.rescore(tx, ctx.tenantId, ctx.leadId, null);
          return { updated: changed, score: scored?.score ?? null, temperature: scored?.temperature ?? null };
        });
        return { ok: true, result };
      }
      case 'calculate_lead_score': {
        const r = await this.tx(ctx, async (tx) => { await this.scoring.rescore(tx, ctx.tenantId, ctx.leadId, null); const l = await tx.lead.findUniqueOrThrow({ where: { id: ctx.leadId } }); return { score: l.score, temperature: l.temperature }; });
        return { ok: true, result: { ...r, note: 'Unknown signals are not held against the customer.' } };
      }
      case 'assign_agent': {
        const r = await this.tx(ctx, async (tx) => {
          const agents = await tx.membership.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE', role: { key: { in: ['agent', 'manager'] } } }, select: { id: true, userId: true, role: { select: { key: true } } } });
          if (!agents.length) return null;
          const load = await tx.lead.groupBy({ by: ['assignedMembershipId'], where: { tenantId: ctx.tenantId, deletedAt: null, stage: { kind: 'OPEN' }, assignedMembershipId: { in: agents.map((x) => x.id) } }, _count: { _all: true } });
          const n = new Map(load.map((x) => [x.assignedMembershipId, x._count._all]));
          const pool = agents.filter((x) => x.role.key === 'agent').length ? agents.filter((x) => x.role.key === 'agent') : agents;
          const pick = [...pool].sort((x, y) => (n.get(x.id) ?? 0) - (n.get(y.id) ?? 0) || x.id.localeCompare(y.id))[0] as (typeof agents)[number];
          await tx.lead.update({ where: { id: ctx.leadId }, data: { assignedMembershipId: pick.id } });
          await tx.conversation.update({ where: { id: ctx.conversationId }, data: { assignedMembershipId: pick.id } });
          await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, leadId: ctx.leadId, type: 'assigned', actorUserId: null, data: { to: pick.id, by: 'ai', reason: (a as { reason: string }).reason } } });
          const u = await tx.user.findUniqueOrThrow({ where: { id: pick.userId }, select: { name: true } });
          return { agent: u.name };
        });
        return r ? { ok: true, result: r } : { ok: false, result: { error: 'no_agents_available' } };
      }
      case 'create_followup': {
        const f = a as z.infer<typeof inputs.create_followup>;
        const at = new Date(Date.now() + f.inHours * 3600_000);
        await this.tx(ctx, async (tx) => {
          await tx.lead.update({ where: { id: ctx.leadId }, data: { nextFollowUpAt: at } });
          await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, leadId: ctx.leadId, type: 'followup_scheduled', actorUserId: null, data: { at: at.toISOString(), note: f.note, by: 'ai' } } });
        });
        return { ok: true, result: { followUpAt: at.toISOString() } };
      }
      case 'handover_to_human': {
        const f = a as z.infer<typeof inputs.handover_to_human>;
        const open = isOpenNow(ctx.assistant.workingHours, ctx.tenant.timezone);
        const assigned = await this.tx(ctx, async (tx) => {
          const c = await tx.conversation.findUniqueOrThrow({ where: { id: ctx.conversationId } });
          await tx.conversation.update({ where: { id: ctx.conversationId }, data: { mode: 'HUMAN', tags: [...new Set([...c.tags, 'needs-human'])] } });
          await tx.message.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, conversationId: ctx.conversationId, channelId: c.channelId, direction: 'OUTBOUND', senderType: 'SYSTEM', type: 'TEXT', body: `The assistant handed this conversation to the team: ${f.reason}`, status: 'DELIVERED' } });
          await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, leadId: ctx.leadId, type: 'ai_handover', actorUserId: null, data: { reason: f.reason } } });
          await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: null, action: 'ai.handover', resourceType: 'conversation', resourceId: ctx.conversationId, metadata: { reason: f.reason.slice(0, 200) } });
          return c.assignedMembershipId;
        });
        this.rt.publish(ctx.tenantId, { type: 'conversation.updated', conversationId: ctx.conversationId, assignedMembershipId: assigned });
        return { ok: true, result: { handedOver: true, teamAvailableNow: open, message: open ? 'Tell the customer a team member has been asked to take over and will reply shortly.' : `Tell the customer the team is currently away${describeHours(ctx.assistant.workingHours) ? ` (hours: ${describeHours(ctx.assistant.workingHours)})` : ''} and will reply when they are back.` } };
      }
    }
  }
}
