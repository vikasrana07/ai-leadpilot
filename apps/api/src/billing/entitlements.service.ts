import { series } from '../common/series.js';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TxClient } from '@leadpilot/database';
import { FEATURE_KEYS, LIMIT_KEYS, type FeatureKey, type LimitKey, type SubscriptionStatusKey } from '@leadpilot/validation';
import { resolveRange } from '../analytics/date-range.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';

export type EffectiveStatus = SubscriptionStatusKey | 'INTERNAL';
export interface Entitlements {
  planKey: string; planName: string; status: EffectiveStatus;
  /** Writes are refused (402) until the workspace pays: trial over, grace over, or cancelled period over. Reads, exports and billing keep working. */
  restricted: boolean;
  inGrace: boolean; graceEndsAt: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; pendingPlanKey: string | null;
  /** null = unlimited */
  limits: Record<LimitKey, number | null>;
  features: Record<FeatureKey, boolean>;
}

/** 402 with a machine-readable code the UI turns into an upgrade prompt. */
export function paymentRequired(code: 'subscription_required' | 'feature_not_in_plan' | 'quota_exceeded', message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ code, message, details: extra }, HttpStatus.PAYMENT_REQUIRED);
}

const MB = 1024 * 1024;

/**
 * The single answer to "what may this workspace do right now". Everything that gates behaviour (HTTP guard, AI, automations,
 * outbound messages, seat checks) asks here, so plan rules are enforced in the backend and in one place.
 */
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, { at: number; value: Entitlements }>();
  private readonly ttlMs: number;
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ENV) env: Env) {
    this.ttlMs = env.NODE_ENV === 'test' ? 0 : 10_000;
  }

  invalidate(tenantId: string): void { this.cache.delete(tenantId); }

  async get(tenantId: string, now = new Date()): Promise<Entitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && this.ttlMs > 0 && now.getTime() - hit.at < this.ttlMs) return hit.value;
    const value = await this.db.tenantTx({ tenantId }, (tx) => this.compute(tx, tenantId, now));
    if (this.ttlMs > 0) this.cache.set(tenantId, { at: now.getTime(), value });
    return value;
  }

  /** Pure read inside the caller's transaction (no cache). */
  async compute(tx: TxClient, tenantId: string, now = new Date()): Promise<Entitlements> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { planKey: true } });
    const sub = await tx.subscription.findUnique({ where: { tenantId } });
    const planKey = sub?.planKey ?? tenant.planKey;
    const plan = await tx.plan.findUnique({ where: { key: planKey }, include: { entitlements: true } });
    let status: EffectiveStatus = sub?.status ?? 'INTERNAL';
    // Effective status is derived from dates too, so access ends on time even if the lifecycle job has not run yet.
    if (sub) {
      if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt <= now) status = 'EXPIRED';
      if (sub.status === 'PAST_DUE' && sub.graceEndsAt && sub.graceEndsAt <= now) status = 'EXPIRED';
      if (sub.status === 'CANCELED' && sub.currentPeriodEnd && sub.currentPeriodEnd <= now) status = 'EXPIRED';
    }
    const limits = {} as Record<LimitKey, number | null>;
    const features = {} as Record<FeatureKey, boolean>;
    for (const k of LIMIT_KEYS) { const e = plan?.entitlements.find((x) => x.key === k); limits[k] = !plan ? 0 : !e ? 0 : !e.enabled ? 0 : e.limit; }
    for (const k of FEATURE_KEYS) features[k] = plan?.entitlements.find((x) => x.key === k)?.enabled ?? false;
    return {
      planKey, planName: plan?.name ?? planKey, status, restricted: status === 'EXPIRED', inGrace: status === 'PAST_DUE',
      graceEndsAt: sub?.graceEndsAt?.toISOString() ?? null, trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null, currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false, pendingPlanKey: sub?.pendingPlanKey ?? null, limits, features,
    };
  }

  async assertFeature(tenantId: string, key: FeatureKey): Promise<void> {
    const e = await this.get(tenantId);
    if (!e.features[key]) throw paymentRequired('feature_not_in_plan', `${labelOf(key)} is not included in your ${e.planName} plan. Upgrade to use it.`, { feature: key, plan: e.planKey });
  }

  /** Throws when `projected` would exceed the plan limit. Unlimited plans pass. */
  async assertWithin(tenantId: string, key: LimitKey, projected: number, label: string): Promise<void> {
    const e = await this.get(tenantId);
    const limit = e.limits[key];
    if (limit !== null && projected > limit) throw paymentRequired('quota_exceeded', `Your ${e.planName} plan allows ${limit.toLocaleString('en-IN')} ${label}. Upgrade your plan or free some up.`, { limit: key, allowed: limit, plan: e.planKey });
  }

  /** "Can this workspace add `add` more of `key`?" Computes current usage itself. */
  async assertCanAdd(tenantId: string, key: LimitKey, label: string, add = 1): Promise<void> {
    const e = await this.get(tenantId);
    if (e.limits[key] === null) return;
    const used = (await this.db.tenantTx({ tenantId }, (tx) => this.usage(tx, tenantId)))[key];
    await this.assertWithin(tenantId, key, used + add, label);
  }

  /** Outbound WhatsApp is metered as a fair-use limit (tenants pay Meta directly; this stops runaway sends). Call inside the sending transaction. */
  async assertCanSendWhatsapp(tx: TxClient, tenantId: string): Promise<void> {
    const e = await this.compute(tx, tenantId);
    const limit = e.limits.whatsapp_messages_monthly;
    if (limit === null) return;
    const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
    const month = resolveRange({ range: 'month' }, tz);
    const sent = await tx.message.count({ where: { tenantId, direction: 'OUTBOUND', senderType: { in: ['AGENT', 'AI', 'SYSTEM'] }, conversation: { channel: { type: 'WHATSAPP' } }, createdAt: { gte: month.from, lt: month.to } } });
    if (sent >= limit) throw paymentRequired('quota_exceeded', `You have used all ${limit.toLocaleString('en-IN')} WhatsApp messages included in your ${e.planName} plan this month. Upgrade your plan to send more.`, { limit: 'whatsapp_messages_monthly', allowed: limit, plan: e.planKey });
  }

  /** Current consumption against each limit, in the units the limits use. */
  async usage(tx: TxClient, tenantId: string, now = new Date()): Promise<Record<LimitKey, number>> {
    const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
    const month = resolveRange({ range: 'month' }, tz, now);
    const inRange = { gte: month.from, lt: month.to };
    const [seats, invites, automations, docs, ai, wa] = await series([ () => tx.membership.count({ where: { tenantId, status: 'ACTIVE' } }), () => tx.invitation.count({ where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }), () => tx.automation.count({ where: { tenantId, enabled: true } }), () => tx.knowledgeDocument.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } }), () => tx.aiRun.aggregate({ where: { tenantId, createdAt: inRange }, _sum: { inputTokens: true, outputTokens: true } }), () => tx.message.count({ where: { tenantId, direction: 'OUTBOUND', senderType: { in: ['AGENT', 'AI', 'SYSTEM'] }, conversation: { channel: { type: 'WHATSAPP' } }, createdAt: inRange } })]);
    return { seats: seats + invites, active_automations: automations, knowledge_mb: Math.ceil((docs._sum.sizeBytes ?? 0) / MB), ai_tokens_monthly: (ai._sum.inputTokens ?? 0) + (ai._sum.outputTokens ?? 0), whatsapp_messages_monthly: wa };
  }
}

function labelOf(k: FeatureKey): string {
  return ({ ai_assistant: 'The AI assistant', automations: 'Automations', web_widget: 'The website chat widget', csv_export: 'CSV export' } as const)[k];
}
