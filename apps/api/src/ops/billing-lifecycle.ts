import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENTITLEMENT_LABELS, LIMIT_KEYS, type LimitKey } from '@leadpilot/validation';
import { resolveRange } from '../analytics/date-range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DbService } from '../db/db.module.js';
import { BillingNotifier } from './billing-notify.js';
import { evaluateTokenCap } from '../ai/token-cap.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

const MONTHLY: ReadonlySet<LimitKey> = new Set(['ai_tokens_monthly', 'whatsapp_messages_monthly']);
const DAY = 86_400_000;

/**
 * Time-driven billing work, run by the minute scanner once per tenant. Idempotent: state changes are derived from dates, and every
 * notice is exactly-once through an event mark, so overlapping ticks or two workers never double-notify.
 */
@Injectable()
export class BillingLifecycle {
  private readonly log = new Logger('BillingLifecycle');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(EntitlementsService) private readonly ent: EntitlementsService, @Inject(BillingNotifier) private readonly notifier: BillingNotifier, @Inject(ENV) private readonly env: Env) {}

  async tick(tenantId: string, now = new Date()): Promise<{ expired: boolean; notices: number }> {
    const s = await this.db.tenantTx({ tenantId }, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      const e = await this.ent.compute(tx, tenantId, now);
      const usage = await this.ent.usage(tx, tenantId, now);
      const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
      let expiredFrom: string | null = null;
      if (sub && e.status === 'EXPIRED' && sub.status !== 'EXPIRED') { expiredFrom = sub.status; await tx.subscription.update({ where: { tenantId }, data: { status: 'EXPIRED' } }); }
      const range = resolveRange({ range: 'month' }, tz, now);
      // The AI allowance is the tighter of the plan's and the owner's own cap (AI Assistant settings), so warn against what actually binds.
      const ownAiCap = (await tx.aiAssistant.findUnique({ where: { tenantId }, select: { monthlyTokenCap: true } }))?.monthlyTokenCap ?? this.env.AI_DEFAULT_MONTHLY_TOKEN_CAP;
      return { sub, e, usage, range, ownAiCap, month: range.from.toISOString().slice(0, 7), expiredFrom };
    });
    if (s.expiredFrom) this.ent.invalidate(tenantId);
    let notices = 0;
    const send = async (...a: Parameters<BillingNotifier['notifyOwners']>) => { if (await this.notifier.notifyOwners(...a).catch((e: unknown) => { this.log.error(`notice failed: ${e instanceof Error ? e.message : String(e)}`); return false; })) notices++; };

    if (s.expiredFrom && s.sub) {
      const trial = s.expiredFrom === 'TRIALING';
      await send(tenantId, { type: 'billing', title: trial ? 'Your free trial has ended' : 'Your subscription has lapsed', body: 'Your workspace is now read-only. Choose a plan to keep making changes. Nothing has been deleted.', link: '/billing',
        email: { subject: trial ? 'Your LeadPilot trial has ended' : 'Your LeadPilot subscription has lapsed', text: 'Your workspace is now read-only: you can still view and export your data, but changes are paused until a plan is active. Nothing has been deleted.' } }, `expired:${s.sub.id}:${s.sub.trialEndsAt?.toISOString() ?? s.sub.currentPeriodEnd?.toISOString() ?? s.sub.graceEndsAt?.toISOString() ?? 'x'}`);
    }
    const trialEnds = s.sub?.status === 'TRIALING' ? s.sub.trialEndsAt : null;
    if (trialEnds && trialEnds > now && trialEnds.getTime() - now.getTime() <= 3 * DAY) {
      await send(tenantId, { type: 'billing', title: 'Your free trial ends soon', body: `Your trial ends on ${trialEnds.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Choose a plan to avoid interruption.`, link: '/billing',
        email: { subject: 'Your LeadPilot trial ends soon', text: `Your free trial ends on ${trialEnds.toISOString().slice(0, 10)}. Choose a plan to keep your workspace fully active.` } }, `trial-ending:${s.sub?.id}:${trialEnds.toISOString().slice(0, 10)}`);
    }
    for (const k of LIMIT_KEYS) {
      let limit = s.e.limits[k];
      let ai: ReturnType<typeof evaluateTokenCap> | null = null;
      if (k === 'ai_tokens_monthly') {
        ai = evaluateTokenCap({ used: s.usage[k], ownCap: s.ownAiCap, planCap: limit, now, monthStart: s.range.from, monthEnd: s.range.to, gracePct: this.env.AI_CAP_GRACE_PCT });
        limit = ai.cap;
      }
      if (limit === null || limit <= 0) continue;
      const pct = (s.usage[k] / limit) * 100;
      // 95% is only worth a separate notice for the AI allowance, where hitting the cap changes how customers are served.
      const level = pct >= 100 ? 100 : ai && pct >= 95 ? 95 : pct >= 80 ? 80 : 0;
      if (!level) continue;
      // Monthly meters re-arm each month; stock meters (seats...) re-arm when the plan limit changes.
      const scope = MONTHLY.has(k) ? s.month : `limit${limit}`;
      if (ai) {
        const fix = ai.source === 'own' ? 'Raise the monthly AI limit in AI Assistant settings' : `Upgrade your plan to get a larger AI allowance`;
        const forecast = ai.projectedExhaustionAt ? ` At the current pace it runs out around ${new Date(ai.projectedExhaustionAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.` : '';
        const link = ai.source === 'own' ? '/ai-assistant' : '/billing';
        const used = `${s.usage[k].toLocaleString('en-IN')} of ${limit.toLocaleString('en-IN')} AI tokens used this month.`;
        const notice = level === 100
          ? { title: 'AI replies are paused for new chats', body: `${used} New conversations are now handed to your team; chats the AI is already handling can finish. ${fix} to resume.`, subject: 'Your AI assistant has reached its monthly limit' }
          : level === 95 ? { title: 'AI tokens: 95% used', body: `${used}${forecast} ${fix} to avoid interruption.`, subject: 'Your AI assistant is almost at its monthly limit' }
          : { title: `AI tokens: ${Math.floor(pct)}% used`, body: `${used}${forecast}`, subject: '' };
        await send(tenantId, { type: 'quota', title: notice.title, body: notice.body, link, ...(notice.subject ? { email: { subject: notice.subject, text: notice.body } } : {}) }, `quota:${k}:${scope}:${level}`);
        continue;
      }
      await send(tenantId, { type: 'quota', title: level === 100 ? `${ENTITLEMENT_LABELS[k]}: limit reached` : `${ENTITLEMENT_LABELS[k]}: ${Math.floor(pct)}% used`, body: level === 100 ? `You have used all ${limit.toLocaleString('en-IN')} on the ${s.e.planName} plan.` : `${s.usage[k].toLocaleString('en-IN')} of ${limit.toLocaleString('en-IN')} used on the ${s.e.planName} plan.`, link: '/usage' }, `quota:${k}:${scope}:${level}`);
    }
    return { expired: !!s.expiredFrom, notices };
  }
}
