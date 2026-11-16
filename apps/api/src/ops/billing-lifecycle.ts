import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENTITLEMENT_LABELS, LIMIT_KEYS, type LimitKey } from '@leadpilot/validation';
import { resolveRange } from '../analytics/date-range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DbService } from '../db/db.module.js';
import { BillingNotifier } from './billing-notify.js';

const MONTHLY: ReadonlySet<LimitKey> = new Set(['ai_tokens_monthly', 'whatsapp_messages_monthly']);
const DAY = 86_400_000;

/**
 * Time-driven billing work, run by the minute scanner once per tenant. Idempotent: state changes are derived from dates, and every
 * notice is exactly-once through an event mark, so overlapping ticks or two workers never double-notify.
 */
@Injectable()
export class BillingLifecycle {
  private readonly log = new Logger('BillingLifecycle');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(EntitlementsService) private readonly ent: EntitlementsService, @Inject(BillingNotifier) private readonly notifier: BillingNotifier) {}

  async tick(tenantId: string, now = new Date()): Promise<{ expired: boolean; notices: number }> {
    const s = await this.db.tenantTx({ tenantId }, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      const e = await this.ent.compute(tx, tenantId, now);
      const usage = await this.ent.usage(tx, tenantId, now);
      const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
      let expiredFrom: string | null = null;
      if (sub && e.status === 'EXPIRED' && sub.status !== 'EXPIRED') { expiredFrom = sub.status; await tx.subscription.update({ where: { tenantId }, data: { status: 'EXPIRED' } }); }
      return { sub, e, usage, month: resolveRange({ range: 'month' }, tz, now).from.toISOString().slice(0, 7), expiredFrom };
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
      const limit = s.e.limits[k];
      if (limit === null || limit <= 0) continue;
      const pct = (s.usage[k] / limit) * 100;
      const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
      if (!level) continue;
      // Monthly meters re-arm each month; stock meters (seats...) re-arm when the plan limit changes.
      const scope = MONTHLY.has(k) ? s.month : `limit${limit}`;
      await send(tenantId, { type: 'quota', title: level === 100 ? `${ENTITLEMENT_LABELS[k]}: limit reached` : `${ENTITLEMENT_LABELS[k]}: ${Math.floor(pct)}% used`, body: level === 100 ? `You have used all ${limit.toLocaleString('en-IN')} on the ${s.e.planName} plan.` : `${s.usage[k].toLocaleString('en-IN')} of ${limit.toLocaleString('en-IN')} used on the ${s.e.planName} plan.`, link: '/usage' }, `quota:${k}:${scope}:${level}`);
    }
    return { expired: !!s.expiredFrom, notices };
  }
}
