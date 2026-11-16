import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export interface ProviderPlanSpec { name: string; amountMinor: number; currency: string }
export interface ProviderSubscription { id: string }

/** What the billing service needs from a payment provider. Razorpay implements it live; a mock implements it for dev/test. */
export interface BillingProvider {
  readonly mode: 'mock' | 'live';
  readonly publicKeyId: string | null;
  createPlan(spec: ProviderPlanSpec): Promise<{ id: string }>;
  createSubscription(i: { planId: string; tenantId: string; startAt?: Date | undefined }): Promise<ProviderSubscription>;
  /** upgrade → now (provider prorates), downgrade → cycle_end. */
  updateSubscription(subscriptionId: string, i: { planId: string; changeAt: 'now' | 'cycle_end' }): Promise<void>;
  cancelSubscription(subscriptionId: string, atCycleEnd: boolean): Promise<void>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

export function hmacHex(secret: string, body: Buffer | string): string { return createHmac('sha256', secret).update(body).digest('hex'); }
function safeEqual(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

/** Local/test provider. Webhook signatures are REAL HMACs, so the production verification code path is exercised in tests. Not allowed in production. */
@Injectable()
export class MockBillingProvider implements BillingProvider {
  readonly mode = 'mock' as const;
  readonly publicKeyId = 'rzp_test_mock';
  readonly calls: { op: string; args: unknown }[] = [];
  private readonly secret: string;
  constructor(@Inject(ENV) env: Env) { this.secret = env.RAZORPAY_WEBHOOK_SECRET ?? MOCK_WEBHOOK_SECRET; }
  async createPlan(spec: ProviderPlanSpec) { this.calls.push({ op: 'createPlan', args: spec }); return { id: `plan_mock_${randomBytes(6).toString('hex')}` }; }
  async createSubscription(i: { planId: string; tenantId: string; startAt?: Date | undefined }) { this.calls.push({ op: 'createSubscription', args: i }); return { id: `sub_mock_${randomBytes(8).toString('hex')}` }; }
  async updateSubscription(id: string, i: { planId: string; changeAt: 'now' | 'cycle_end' }) { this.calls.push({ op: 'updateSubscription', args: { id, ...i } }); }
  async cancelSubscription(id: string, atCycleEnd: boolean) { this.calls.push({ op: 'cancelSubscription', args: { id, atCycleEnd } }); }
  verifyWebhookSignature(raw: Buffer, signature: string | undefined): boolean { return !!signature && safeEqual(signature, hmacHex(this.secret, raw)); }
  /** Builds a signed Razorpay-shaped webhook body (used by tests and the dev-only simulator). */
  sign(body: Buffer): string { return hmacHex(this.secret, body); }
}
export const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret-for-local-dev-only';

const API = 'https://api.razorpay.com/v1';

/**
 * Razorpay over plain HTTPS (no SDK dependency). Request shapes follow Razorpay's documented Plans/Subscriptions API.
 * NOT YET VERIFIED against Razorpay (needs test-mode keys): see docs/decisions/0005-saas-billing.md.
 */
@Injectable()
export class LiveBillingProvider implements BillingProvider {
  readonly mode = 'live' as const;
  readonly publicKeyId: string | null;
  private readonly auth: string;
  private readonly webhookSecret: string;
  constructor(@Inject(ENV) env: Env) {
    this.publicKeyId = env.RAZORPAY_KEY_ID ?? null;
    this.auth = `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID ?? ''}:${env.RAZORPAY_KEY_SECRET ?? ''}`).toString('base64')}`;
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? '';
  }

  private async call<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    let res: Response;
    try { res = await fetch(`${API}${path}`, { method, headers: { authorization: this.auth, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); }
    catch { throw new BadGatewayException({ code: 'payment_provider_unreachable', message: 'The payment provider could not be reached. Please try again.' }); }
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
    if (!res.ok) throw new BadGatewayException({ code: 'payment_provider_error', message: json.error?.description ?? 'The payment provider rejected the request.' });
    return json;
  }

  createPlan(spec: ProviderPlanSpec) { return this.call<{ id: string }>('POST', '/plans', { period: 'monthly', interval: 1, item: { name: spec.name, amount: spec.amountMinor, currency: spec.currency } }); }
  createSubscription(i: { planId: string; tenantId: string; startAt?: Date | undefined }) {
    return this.call<{ id: string }>('POST', '/subscriptions', { plan_id: i.planId, total_count: 120, customer_notify: 1, notes: { tenant_id: i.tenantId }, ...(i.startAt ? { start_at: Math.floor(i.startAt.getTime() / 1000) } : {}) });
  }
  async updateSubscription(id: string, i: { planId: string; changeAt: 'now' | 'cycle_end' }) { await this.call('PATCH', `/subscriptions/${encodeURIComponent(id)}`, { plan_id: i.planId, schedule_change_at: i.changeAt }); }
  async cancelSubscription(id: string, atCycleEnd: boolean) { await this.call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }); }
  verifyWebhookSignature(raw: Buffer, signature: string | undefined): boolean { return !!signature && !!this.webhookSecret && safeEqual(signature, hmacHex(this.webhookSecret, raw)); }
}
