import { series } from '../common/series.js';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, type TxClient } from '@leadpilot/database';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, financialYear, GST_RATE_PERCENT, LIMIT_KEYS, splitGst, STATE_CODES, withGst, type BillingProfileInput, type LimitKey } from '@leadpilot/validation';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { BillingNotifier } from '../ops/billing-notify.js';
import { EntitlementsService } from './entitlements.service.js';
import { buildMockEvent, type MockEventKind } from './mock-events.js';
import { BILLING_PROVIDER, type BillingProvider, MockBillingProvider } from './provider.js';

const DAY = 86_400_000;

const rzEvent = z.object({
  event: z.string(),
  created_at: z.number().optional(),
  payload: z.object({
    subscription: z.object({ entity: z.object({ id: z.string(), status: z.string().optional(), current_start: z.number().nullable().optional(), current_end: z.number().nullable().optional() }) }).optional(),
    payment: z.object({ entity: z.object({ id: z.string(), amount: z.number(), currency: z.string().optional(), status: z.string().optional(), error_description: z.string().nullable().optional() }) }).optional(),
  }),
});
type RzEvent = z.infer<typeof rzEvent>;

export interface WebhookResult { status: 'processed' | 'ignored' | 'duplicate'; reason?: string }

@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
    @Inject(EntitlementsService) private readonly ent: EntitlementsService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    @Inject(BillingNotifier) private readonly notifier: BillingNotifier,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ catalogue & summary
  private planView(p: { key: string; name: string; description: string; priceMinor: number; currency: string; trialDays: number; entitlements: { key: string; enabled: boolean; limit: number | null }[] }) {
    return {
      key: p.key, name: p.name, description: p.description, priceMinor: p.priceMinor, priceWithGstMinor: withGst(p.priceMinor), currency: p.currency, trialDays: p.trialDays,
      limits: Object.fromEntries(LIMIT_KEYS.map((k) => { const e = p.entitlements.find((x) => x.key === k); return [k, e && e.enabled ? e.limit : 0]; })) as Record<LimitKey, number | null>,
      features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, p.entitlements.find((x) => x.key === k)?.enabled ?? false])),
    };
  }

  async plans() {
    const rows = await this.db.prisma.plan.findMany({ where: { active: true, isPublic: true }, include: { entitlements: true }, orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] });
    return rows.map((p) => this.planView(p));
  }

  async summary(ctx: TenantRequestContext) {
    const { e, usage, profile, sub } = await this.db.tenantTx(ctx, async (tx) => ({
      e: await this.ent.compute(tx, ctx.tenantId), usage: await this.ent.usage(tx, ctx.tenantId),
      profile: await tx.billingProfile.findUnique({ where: { tenantId: ctx.tenantId } }),
      sub: await tx.subscription.findUnique({ where: { tenantId: ctx.tenantId }, select: { provider: true, providerSubscriptionId: true, lastPaymentFailedAt: true } }),
    }));
    const current = await this.db.prisma.plan.findUnique({ where: { key: e.planKey }, include: { entitlements: true } });
    const canManage = ctx.permissions.has('billing:manage');
    return {
      ...e, usage, gstRatePercent: GST_RATE_PERCENT, priceMinor: current?.priceMinor ?? 0,
      canManage, provider: { mode: this.provider.mode, hasPaymentMethod: !!sub?.providerSubscriptionId && sub.provider === 'razorpay', lastPaymentFailedAt: sub?.lastPaymentFailedAt?.toISOString() ?? null },
      billingProfileComplete: !!profile,
    };
  }

  // ------------------------------------------------------------------ billing profile (GST details)
  async getProfile(ctx: TenantRequestContext) {
    const p = await this.db.tenantTx(ctx, (tx) => tx.billingProfile.findUnique({ where: { tenantId: ctx.tenantId } }));
    return p ? { legalName: p.legalName, gstin: p.gstin, stateCode: p.stateCode, addressLine: p.addressLine, city: p.city, pincode: p.pincode } : null;
  }

  async saveProfile(ctx: TenantRequestContext, input: BillingProfileInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      const data = { legalName: input.legalName, gstin: input.gstin, stateCode: input.stateCode, addressLine: input.addressLine, city: input.city, pincode: input.pincode };
      await tx.billingProfile.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'billing.profile_saved', resourceType: 'billing_profile', resourceId: ctx.tenantId, metadata: { hasGstin: !!input.gstin, stateCode: input.stateCode }, requestId: ctx.requestId, ip: ctx.ip });
      return data;
    });
  }

  // ------------------------------------------------------------------ subscribe / change / cancel
  private async providerPlanFor(plan: { key: string; name: string; priceMinor: number; currency: string; razorpayPlanId: string | null; razorpayPlanAmount: number | null }): Promise<string> {
    const amount = withGst(plan.priceMinor);
    // Provider plans are immutable: a price change needs a new provider plan. Existing subscribers keep the plan they bought.
    if (plan.razorpayPlanId && plan.razorpayPlanAmount === amount) return plan.razorpayPlanId;
    const created = await this.provider.createPlan({ name: `LeadPilot ${plan.name}`, amountMinor: amount, currency: plan.currency });
    await this.db.prisma.plan.update({ where: { key: plan.key }, data: { razorpayPlanId: created.id, razorpayPlanAmount: amount } });
    return created.id;
  }

  private async purchasable(planKey: string) {
    const plan = await this.db.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan || !plan.active || !plan.isPublic || plan.priceMinor <= 0) throw new NotFoundException({ code: 'plan_unavailable', message: 'That plan is not available' });
    return plan;
  }

  private setPlan(tx: TxClient, tenantId: string, planKey: string) { return tx.tenant.update({ where: { id: tenantId }, data: { planKey } }); }

  async subscribe(ctx: TenantRequestContext, planKey: string) {
    const plan = await this.purchasable(planKey);
    const now = new Date();
    const state = await this.db.tenantTx(ctx, async (tx) => ({
      profile: await tx.billingProfile.findUnique({ where: { tenantId: ctx.tenantId }, select: { tenantId: true } }),
      sub: await tx.subscription.findUnique({ where: { tenantId: ctx.tenantId } }),
    }));
    if (!state.profile) throw new ConflictException({ code: 'billing_profile_required', message: 'Add your billing details (name, state and address, GSTIN if you have one) before subscribing.' });
    const sub = state.sub;
    if (sub?.provider === 'razorpay' && sub.providerSubscriptionId && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && !sub.cancelAtPeriodEnd) {
      throw new ConflictException({ code: 'already_subscribed', message: 'You already have an active subscription. Use "Change plan" instead.' });
    }
    const providerPlanId = await this.providerPlanFor(plan);
    // A remaining trial or paid period is not wasted: the first charge is scheduled for when it ends.
    const startAt = sub?.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() > now.getTime() + 10 * 60_000 ? sub.trialEndsAt
      : sub?.status === 'CANCELED' && sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime() + 10 * 60_000 ? sub.currentPeriodEnd : undefined;
    const created = await this.provider.createSubscription({ planId: providerPlanId, tenantId: ctx.tenantId, startAt });
    await this.db.tenantTx(ctx, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { planKey: true } });
      const data = { provider: 'razorpay', providerSubscriptionId: created.id, pendingPlanKey: plan.key, cancelAtPeriodEnd: false };
      if (sub) await tx.subscription.update({ where: { tenantId: ctx.tenantId }, data });
      else await tx.subscription.create({ data: { tenantId: ctx.tenantId, planKey: tenant.planKey, status: 'ACTIVE', ...data } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'billing.checkout_started', resourceType: 'subscription', resourceId: created.id, metadata: { planKey: plan.key, mode: this.provider.mode }, requestId: ctx.requestId, ip: ctx.ip });
    });
    this.ent.invalidate(ctx.tenantId);
    return { subscriptionId: created.id, keyId: this.provider.publicKeyId, mode: this.provider.mode, planKey: plan.key, planName: plan.name, amountMinor: withGst(plan.priceMinor), currency: plan.currency, startsAt: startAt?.toISOString() ?? null };
  }

  async changePlan(ctx: TenantRequestContext, planKey: string) {
    const target = await this.purchasable(planKey);
    const sub = await this.db.tenantTx(ctx, (tx) => tx.subscription.findUnique({ where: { tenantId: ctx.tenantId } }));
    if (!sub?.providerSubscriptionId || sub.provider !== 'razorpay') throw new ConflictException({ code: 'no_active_subscription', message: 'You do not have a paid subscription yet. Choose a plan to subscribe.' });
    if (sub.status === 'PAST_DUE') throw new ConflictException({ code: 'payment_due', message: 'Resolve the failed payment before changing plans.' });
    if (sub.status !== 'ACTIVE' || sub.cancelAtPeriodEnd) throw new ConflictException({ code: 'not_changeable', message: 'This subscription is ending. Subscribe again to choose a different plan.' });
    if (target.key === sub.planKey && !sub.pendingPlanKey) throw new ConflictException({ code: 'same_plan', message: 'You are already on this plan.' });
    const current = await this.db.prisma.plan.findUniqueOrThrow({ where: { key: sub.planKey } });
    const upgrade = target.priceMinor > current.priceMinor;
    if (!upgrade) {
      // Never silently strand a customer over their new limits: tell them exactly what to reduce first.
      const full = await this.db.prisma.plan.findUniqueOrThrow({ where: { key: target.key }, include: { entitlements: true } });
      const usage = await this.db.tenantTx(ctx, (tx) => this.ent.usage(tx, ctx.tenantId));
      const view = this.planView(full);
      const problems = LIMIT_KEYS.filter((k) => k !== 'ai_tokens_monthly' && k !== 'whatsapp_messages_monthly' && view.limits[k] !== null && usage[k] > (view.limits[k] as number))
        .map((k) => ({ key: k, label: ENTITLEMENT_LABELS[k], used: usage[k], allowed: view.limits[k] as number }));
      if (problems.length) throw new ConflictException({ code: 'over_quota', message: `You are using more than ${target.name} allows. Reduce these first: ${problems.map((p) => `${p.label} (${p.used} of ${p.allowed})`).join(', ')}.`, details: problems });
    }
    const providerPlanId = await this.providerPlanFor(target);
    await this.provider.updateSubscription(sub.providerSubscriptionId, { planId: providerPlanId, changeAt: upgrade ? 'now' : 'cycle_end' });
    await this.db.tenantTx(ctx, async (tx) => {
      if (upgrade) { await tx.subscription.update({ where: { tenantId: ctx.tenantId }, data: { planKey: target.key, pendingPlanKey: null } }); await this.setPlan(tx, ctx.tenantId, target.key); }
      else await tx.subscription.update({ where: { tenantId: ctx.tenantId }, data: { pendingPlanKey: target.key } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: upgrade ? 'billing.upgraded' : 'billing.downgrade_scheduled', resourceType: 'subscription', resourceId: sub.id, metadata: { from: sub.planKey, to: target.key }, requestId: ctx.requestId, ip: ctx.ip });
    });
    this.ent.invalidate(ctx.tenantId);
    return { effective: upgrade ? 'now' : 'cycle_end', planKey: target.key };
  }

  async cancel(ctx: TenantRequestContext) {
    const sub = await this.db.tenantTx(ctx, (tx) => tx.subscription.findUnique({ where: { tenantId: ctx.tenantId } }));
    if (!sub || sub.status === 'EXPIRED' || sub.status === 'CANCELED' || sub.cancelAtPeriodEnd) throw new ConflictException({ code: 'nothing_to_cancel', message: 'There is no active subscription to cancel.' });
    if (sub.providerSubscriptionId && sub.provider === 'razorpay') await this.provider.cancelSubscription(sub.providerSubscriptionId, true);
    await this.db.tenantTx(ctx, async (tx) => {
      // A trial that never became a paid subscription simply ends on its date.
      const trialOnly = !sub.providerSubscriptionId;
      await tx.subscription.update({ where: { tenantId: ctx.tenantId }, data: trialOnly ? { status: 'CANCELED', currentPeriodEnd: sub.trialEndsAt ?? new Date() } : { cancelAtPeriodEnd: true, pendingPlanKey: null } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'billing.cancelled', resourceType: 'subscription', resourceId: sub.id, metadata: { trialOnly }, requestId: ctx.requestId, ip: ctx.ip });
    });
    this.ent.invalidate(ctx.tenantId);
    return this.summary(ctx);
  }

  // ------------------------------------------------------------------ invoices
  async invoices(ctx: TenantRequestContext) {
    const rows = await this.db.tenantTx(ctx, (tx) => tx.invoice.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { issuedAt: 'desc' }, take: 100 }));
    return rows.map((i) => ({ id: i.id, number: i.number, planKey: i.planKey, description: i.description, issuedAt: i.issuedAt.toISOString(), totalMinor: i.totalMinor, taxableMinor: i.taxableMinor, currency: i.currency }));
  }

  async invoice(ctx: TenantRequestContext, id: string) {
    const i = await this.db.tenantTx(ctx, (tx) => tx.invoice.findFirst({ where: { id, tenantId: ctx.tenantId } }));
    if (!i) throw new NotFoundException({ code: 'not_found', message: 'Invoice not found' });
    return { id: i.id, number: i.number, issuedAt: i.issuedAt.toISOString(), planKey: i.planKey, description: i.description, periodStart: i.periodStart?.toISOString() ?? null, periodEnd: i.periodEnd?.toISOString() ?? null, currency: i.currency, taxableMinor: i.taxableMinor, cgstMinor: i.cgstMinor, sgstMinor: i.sgstMinor, igstMinor: i.igstMinor, totalMinor: i.totalMinor, gstRatePercent: i.gstRatePercent, sac: i.sac, placeOfSupply: i.placeOfSupply, buyer: i.buyer, seller: i.seller, paymentId: i.providerPaymentId };
  }

  /** Issues a GST invoice for a captured payment, once. Inside the caller's transaction so the gap-free number rolls back with a failure. */
  private async issueInvoice(tx: TxClient, tenantId: string, p: { paymentId: string; totalMinor: number; planKey: string; periodStart: Date | null; periodEnd: Date | null }): Promise<string | null> {
    if (await tx.payment.findUnique({ where: { providerPaymentId: p.paymentId } })) return null; // already recorded (duplicate delivery)
    const [plan, profile, tenant] = await series([ () => tx.plan.findUnique({ where: { key: p.planKey } }), () => tx.billingProfile.findUnique({ where: { tenantId } }), () => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } })]);
    const seller = { legalName: this.env.SELLER_LEGAL_NAME, gstin: this.env.SELLER_GSTIN ?? null, stateCode: this.env.SELLER_STATE_CODE, address: this.env.SELLER_ADDRESS };
    const buyer = profile ? { legalName: profile.legalName, gstin: profile.gstin, stateCode: profile.stateCode, address: [profile.addressLine, profile.city, profile.pincode].filter(Boolean).join(', ') } : { legalName: tenant.name, gstin: null, stateCode: seller.stateCode, address: '' };
    const tax = splitGst(p.totalMinor, GST_RATE_PERCENT, buyer.stateCode === seller.stateCode);
    const issued = new Date();
    const num = (await tx.$queryRaw<{ n: string }[]>`SELECT next_invoice_number(${financialYear(issued)}) AS n`)[0]?.n;
    if (!num) throw new Error('invoice number allocation failed');
    const invoiceId = (await tx.invoice.create({ data: {
      tenantId, number: num, planKey: p.planKey, description: `LeadPilot ${plan?.name ?? p.planKey} plan: monthly subscription`, periodStart: p.periodStart, periodEnd: p.periodEnd, currency: 'INR', ...tax, gstRatePercent: GST_RATE_PERCENT,
      sac: this.env.INVOICE_SAC, placeOfSupply: STATE_CODES[buyer.stateCode] ?? buyer.stateCode, buyer, seller, providerPaymentId: p.paymentId, issuedAt: issued } })).id;
    await tx.payment.create({ data: { tenantId, invoiceId, providerPaymentId: p.paymentId, amountMinor: p.totalMinor, status: 'captured' } });
    return invoiceId;
  }

  // ------------------------------------------------------------------ webhooks
  /** Verifies, de-duplicates, then applies a Razorpay event. Throws only for bad signatures (401) or a processing failure (so the provider retries). */
  async handleWebhook(raw: Buffer, signature: string | undefined, eventIdHeader: string | undefined): Promise<WebhookResult> {
    if (!this.provider.verifyWebhookSignature(raw, signature)) throw new UnauthorizedException({ code: 'invalid_signature', message: 'Invalid webhook signature' });
    let json: unknown;
    try { json = JSON.parse(raw.toString('utf8')); } catch { throw new BadRequestException({ code: 'invalid_payload', message: 'Malformed webhook body' }); }
    const ev = rzEvent.safeParse(json);
    if (!ev.success) throw new BadRequestException({ code: 'invalid_payload', message: 'Unrecognised webhook shape' });
    const parsed: RzEvent = ev.data;
    const eventId = eventIdHeader || createHash('sha256').update(raw).digest('hex');
    try {
      await this.db.prisma.billingEvent.create({ data: { provider: 'razorpay', eventId, type: parsed.event, payload: json as Prisma.InputJsonValue } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const prior = await this.db.prisma.billingEvent.findUnique({ where: { provider_eventId: { provider: 'razorpay', eventId } } });
      if (prior && (prior.status === 'processed' || prior.status === 'ignored')) return { status: 'duplicate' };
      // 'received' / 'failed': a previous attempt did not finish. Fall through and apply it again; every step below is idempotent.
    }
    try {
      const result = await this.apply(parsed);
      await this.db.prisma.billingEvent.update({ where: { provider_eventId: { provider: 'razorpay', eventId } }, data: { status: result.status === 'processed' ? 'processed' : 'ignored', processedAt: new Date(), error: result.reason ?? null } });
      return result;
    } catch (e) {
      await this.db.prisma.billingEvent.update({ where: { provider_eventId: { provider: 'razorpay', eventId } }, data: { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }).catch(() => undefined);
      throw e;
    }
  }

  private async apply(ev: RzEvent): Promise<WebhookResult> {
    const subId = ev.payload.subscription?.entity.id;
    if (!subId) return { status: 'ignored', reason: 'no subscription in event' };
    const found = await this.db.prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT billing_tenant_for_subscription(${subId}) AS tenant_id`;
    const tenantId = found[0]?.tenant_id;
    if (!tenantId) return { status: 'ignored', reason: 'unknown subscription' };
    const notices: Parameters<BillingNotifier['notifyOwners']>[] = [];
    const result = await this.db.tenantTx({ tenantId }, async (tx) => {
      // Serialise concurrent events for one workspace; out-of-order and duplicate deliveries then see consistent state.
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub || sub.providerSubscriptionId !== subId) return { status: 'ignored' as const, reason: 'stale subscription' };
      const e = ev.payload.subscription?.entity;
      const pay = ev.payload.payment?.entity;
      const start = e?.current_start ? new Date(e.current_start * 1000) : null;
      const end = e?.current_end ? new Date(e.current_end * 1000) : null;
      const now = new Date();
      switch (ev.event) {
        case 'subscription.activated':
        case 'subscription.charged': {
          const keepCanceled = sub.status === 'CANCELED'; // a late renewal/activation never revives a cancelled subscription
          const planKey = keepCanceled ? sub.planKey : (sub.pendingPlanKey ?? sub.planKey); // first purchase and scheduled downgrades both land here
          await tx.subscription.update({ where: { tenantId }, data: { currentPeriodStart: start ?? sub.currentPeriodStart, currentPeriodEnd: end ?? sub.currentPeriodEnd, ...(keepCanceled ? {} : { status: 'ACTIVE', planKey, pendingPlanKey: null, graceEndsAt: null, lastPaymentFailedAt: null, trialEndsAt: null }) } });
          if (!keepCanceled && planKey !== sub.planKey) await this.setPlan(tx, tenantId, planKey);
          if (ev.event === 'subscription.charged' && pay && pay.status !== 'failed') {
            const invoiceId = await this.issueInvoice(tx, tenantId, { paymentId: pay.id, totalMinor: pay.amount, planKey, periodStart: start, periodEnd: end });
            if (invoiceId) notices.push([tenantId, { type: 'billing', title: 'Payment received. Thank you', body: 'Your GST invoice is ready in Billing.', link: '/billing' }]);
          }
          if (ev.event === 'subscription.activated' && sub.status !== 'ACTIVE') notices.push([tenantId, { type: 'billing', title: 'Your subscription is active', body: 'Thanks for subscribing to LeadPilot.', link: '/billing' }]);
          return { status: 'processed' as const };
        }
        case 'subscription.pending':
        case 'subscription.halted': {
          if (sub.status === 'CANCELED' || sub.status === 'EXPIRED') return { status: 'ignored' as const, reason: 'subscription already ended' };
          const grace = sub.graceEndsAt ?? new Date(now.getTime() + this.env.BILLING_GRACE_DAYS * DAY);
          await tx.subscription.update({ where: { tenantId }, data: { status: 'PAST_DUE', graceEndsAt: grace, lastPaymentFailedAt: now } });
          notices.push([tenantId, { type: 'billing', title: 'Payment failed: update your payment method', body: `Everything keeps working until ${grace.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. After that the workspace becomes read-only.`, link: '/billing', email: { subject: 'Your LeadPilot payment failed', text: `We could not collect your LeadPilot subscription payment. Please update your payment method. Your workspace keeps working until ${grace.toISOString().slice(0, 10)}, after which it becomes read-only until payment succeeds.` } }, `pay-failed:${subId}:${grace.toISOString().slice(0, 10)}`]);
          return { status: 'processed' as const };
        }
        case 'payment.failed': {
          if (pay && !(await tx.payment.findUnique({ where: { providerPaymentId: pay.id } }))) await tx.payment.create({ data: { tenantId, providerPaymentId: pay.id, amountMinor: pay.amount, status: 'failed', failureReason: (pay.error_description ?? 'declined').slice(0, 200) } });
          await tx.subscription.update({ where: { tenantId }, data: { lastPaymentFailedAt: now } });
          return { status: 'processed' as const };
        }
        case 'subscription.cancelled': {
          if (sub.status === 'EXPIRED') return { status: 'ignored' as const, reason: 'already expired' };
          await tx.subscription.update({ where: { tenantId }, data: { status: 'CANCELED', cancelAtPeriodEnd: true, pendingPlanKey: null } });
          notices.push([tenantId, { type: 'billing', title: 'Subscription cancelled', body: sub.currentPeriodEnd ? 'You keep access until the end of the paid period.' : 'Your subscription has ended.', link: '/billing' }]);
          return { status: 'processed' as const };
        }
        case 'subscription.completed': {
          await tx.subscription.update({ where: { tenantId }, data: { status: 'EXPIRED' } });
          return { status: 'processed' as const };
        }
        default: return { status: 'ignored' as const, reason: `unhandled event ${ev.event}` };
      }
    });
    this.ent.invalidate(tenantId);
    for (const n of notices) await this.notifier.notifyOwners(...n).catch((e: unknown) => this.log.error(`notice failed: ${e instanceof Error ? e.message : String(e)}`));
    return result;
  }

  // ------------------------------------------------------------------ dev-only payment simulator (mock provider)
  /** Feeds a SIGNED, Razorpay-shaped event through the real webhook path. Only exists with the mock provider outside production. */
  async simulate(ctx: TenantRequestContext, kind: MockEventKind) {
    if (this.provider.mode !== 'mock' || this.env.NODE_ENV === 'production' || !(this.provider instanceof MockBillingProvider)) throw new NotFoundException({ code: 'not_found', message: 'Not found' });
    if (!ctx.permissions.has('billing:manage')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot manage billing' });
    const sub = await this.db.tenantTx(ctx, (tx) => tx.subscription.findUnique({ where: { tenantId: ctx.tenantId } }));
    if (!sub?.providerSubscriptionId) throw new ConflictException({ code: 'no_checkout', message: 'Start a checkout first.' });
    const plan = await this.db.prisma.plan.findUniqueOrThrow({ where: { key: sub.pendingPlanKey ?? sub.planKey } });
    const { body, eventId } = buildMockEvent({ kind, subscriptionId: sub.providerSubscriptionId, amountMinor: withGst(plan.priceMinor) });
    return this.handleWebhook(body, this.provider.sign(body), eventId);
  }
}
