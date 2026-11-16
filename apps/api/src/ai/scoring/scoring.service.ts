import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../../audit/audit.service.js';
import type { Actor } from '../../common/actor.js';
import { DbService } from '../../db/db.module.js';
import { DEFAULT_SCORING_RULES, scoreLead, temperatureFor, type ScoringRules } from './scoring.js';

export const scoringRulesSchema = z.object({
  criteria: z.array(z.object({
    key: z.enum(['budget_known', 'location_known', 'timeline_30_days', 'requirements_clear', 'site_visit_requested']),
    label: z.string().trim().min(1).max(60), points: z.number().int().min(0).max(100), enabled: z.boolean(),
  })).length(5),
  hotMin: z.number().int().min(1).max(100), warmMin: z.number().int().min(1).max(100),
}).refine((r) => r.warmMin < r.hotMin, { message: 'The Warm threshold must be lower than the Hot threshold', path: ['warmMin'] })
  .refine((r) => new Set(r.criteria.map((c) => c.key)).size === 5, { message: 'Each criterion must appear once', path: ['criteria'] })
  .refine((r) => r.criteria.filter((c) => c.enabled).reduce((s, c) => s + c.points, 0) >= 1, { message: 'Enable at least one criterion with points', path: ['criteria'] });

export const overrideSchema = z.object({ score: z.number().int().min(0).max(100), reason: z.string().trim().min(3, 'Please give a reason').max(300) });

@Injectable()
export class ScoringService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}

  /** The active rules for a tenant (latest version), or the documented defaults as version 0. */
  async rulesFor(tx: TxClient, tenantId: string): Promise<{ version: number; rules: ScoringRules }> {
    const row = await tx.scoringRuleSet.findFirst({ where: { tenantId }, orderBy: { version: 'desc' } });
    return row ? { version: row.version, rules: row.rules as unknown as ScoringRules } : { version: 0, rules: DEFAULT_SCORING_RULES };
  }

  private readonly bulk = new Set<Promise<void>>();
  async idle(): Promise<void> { while (this.bulk.size) await Promise.all([...this.bulk]); }

  /** Re-scores every lead in small transactions (so a large workspace never holds one long transaction). Overridden scores stay put. */
  rescoreAll(tenantId: string): void {
    const p = (async () => {
      let cursor: string | undefined;
      for (;;) {
        const ids = await this.db.tenantTx({ tenantId }, (tx) => tx.lead.findMany({ where: { tenantId, deletedAt: null }, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true } }));
        if (!ids.length) break;
        await this.db.tenantTx({ tenantId }, async (tx) => { for (const l of ids) await this.rescore(tx, tenantId, l.id, null); });
        cursor = ids.at(-1)?.id;
      }
    })().catch(() => undefined).finally(() => { this.bulk.delete(p); });
    this.bulk.add(p);
  }

  async saveRules(a: Actor, rules: ScoringRules) {
    if (!a.permissions.has('ai:configure')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot change scoring rules' });
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const cur = await this.rulesFor(tx, a.tenantId);
      const version = cur.version + 1;
      await tx.scoringRuleSet.create({ data: { id: uuidv7(), tenantId: a.tenantId, version, rules: rules as unknown as Prisma.InputJsonValue, createdBy: a.userId } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'ai.scoring_rules_changed', resourceType: 'scoring_rules', metadata: { version }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return { version, rules };
    }).then((r) => { this.rescoreAll(a.tenantId); return r; });
  }

  /**
   * Recomputes a lead's score from its current fields and records history when something changed. Respects a manual override:
   * history is still written, but the lead's score and temperature stay where the manager put them.
   */
  async rescore(tx: TxClient, tenantId: string, leadId: string, actorUserId: string | null = null): Promise<{ score: number; temperature: string; changed: boolean } | null> {
    const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) return null;
    const { version, rules } = await this.rulesFor(tx, tenantId);
    const r = scoreLead(lead, rules);
    const prev = await tx.leadScore.findFirst({ where: { leadId, source: 'RULES' }, orderBy: { createdAt: 'desc' } });
    const same = prev && prev.score === r.score && prev.ruleVersion === version && JSON.stringify(prev.breakdown) === JSON.stringify(r.breakdown);
    if (!same) await tx.leadScore.create({ data: { id: uuidv7(), tenantId, leadId, score: r.score, temperature: r.temperature, breakdown: r.breakdown as unknown as Prisma.InputJsonValue, ruleVersion: version, source: 'RULES', actorUserId } });
    if (lead.scoreOverridden) return { score: lead.score ?? r.score, temperature: lead.temperature, changed: false };
    const changed = lead.score !== r.score || lead.temperature !== r.temperature;
    if (changed) {
      await tx.lead.update({ where: { id: leadId }, data: { score: r.score, scoreUpdatedAt: new Date(), temperature: r.temperature } });
      await tx.leadActivity.create({ data: { id: uuidv7(), tenantId, leadId, type: 'scored', actorUserId, data: { from: lead.score, to: r.score, temperature: r.temperature } } });
    }
    return { score: r.score, temperature: r.temperature, changed };
  }

  async view(a: Actor, leadId: string) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const scope = a.permissions.has('lead:read:all') ? {} : a.permissions.has('lead:read:own') && a.membershipId ? { assignedMembershipId: a.membershipId } : null;
      if (scope === null) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot view leads' });
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId: a.tenantId, deletedAt: null, ...scope } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const { version, rules } = await this.rulesFor(tx, a.tenantId);
      const live = scoreLead(lead, rules);
      const history = await tx.leadScore.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 30 });
      const users = await tx.user.findMany({ where: { id: { in: history.map((h) => h.actorUserId).filter((x): x is string => x !== null) } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return {
        score: lead.score, temperature: lead.temperature, overridden: lead.scoreOverridden, scoredAt: lead.scoreUpdatedAt?.toISOString() ?? null,
        ruleVersion: version, breakdown: live.breakdown, automaticScore: live.score,
        history: history.map((h) => ({ id: h.id, score: h.score, temperature: h.temperature, source: h.source, reason: h.reason, ruleVersion: h.ruleVersion, actor: h.actorUserId ? names.get(h.actorUserId) ?? null : null, createdAt: h.createdAt.toISOString() })),
      };
    });
  }

  /** Manager override with a mandatory reason; recorded in score history, the lead timeline and the audit log. */
  async override(a: Actor, leadId: string, input: z.infer<typeof overrideSchema>) {
    if (!a.permissions.has('lead:score:override')) throw new ForbiddenException({ code: 'forbidden', message: 'Only managers can override scores' });
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId: a.tenantId, deletedAt: null } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const { version, rules } = await this.rulesFor(tx, a.tenantId);
      const temperature = temperatureFor(input.score, rules);
      await tx.lead.update({ where: { id: leadId }, data: { score: input.score, scoreUpdatedAt: new Date(), scoreOverridden: true, temperature } });
      await tx.leadScore.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId, score: input.score, temperature, breakdown: [], ruleVersion: version, source: 'MANUAL', reason: input.reason, actorUserId: a.userId } });
      await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId, type: 'score_overridden', actorUserId: a.userId, data: { from: lead.score, to: input.score, reason: input.reason } } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'lead.score_overridden', resourceType: 'lead', resourceId: leadId, metadata: { from: lead.score, to: input.score, reason: input.reason }, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return { score: input.score, temperature, overridden: true };
    });
  }

  async clearOverride(a: Actor, leadId: string) {
    if (!a.permissions.has('lead:score:override')) throw new ForbiddenException({ code: 'forbidden', message: 'Only managers can override scores' });
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId: a.tenantId, deletedAt: null } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      if (!lead.scoreOverridden) throw new BadRequestException({ code: 'not_overridden', message: 'This score is already automatic' });
      await tx.lead.update({ where: { id: leadId }, data: { scoreOverridden: false } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'lead.score_override_cleared', resourceType: 'lead', resourceId: leadId, ...(a.requestId ? { requestId: a.requestId } : {}) });
      return this.rescore(tx, a.tenantId, leadId, a.userId);
    });
  }
}
