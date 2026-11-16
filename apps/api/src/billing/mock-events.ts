import { randomUUID } from 'node:crypto';

export type MockEventKind = 'activated' | 'charged' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'payment_failed';

export interface MockEventInput {
  kind: MockEventKind; subscriptionId: string; eventId?: string; paymentId?: string; amountMinor?: number;
  periodStart?: Date; periodEnd?: Date; createdAt?: Date;
}

/** A Razorpay-shaped webhook body (documented subscription.* / payment.failed envelope). Used by tests and the dev-only simulator. */
export function buildMockEvent(i: MockEventInput): { body: Buffer; eventId: string } {
  const eventId = i.eventId ?? `evt_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const start = i.periodStart ?? new Date();
  const end = i.periodEnd ?? new Date(start.getTime() + 30 * 86_400_000);
  const sub = { entity: { id: i.subscriptionId, status: i.kind === 'cancelled' ? 'cancelled' : i.kind === 'halted' ? 'halted' : i.kind === 'pending' ? 'pending' : i.kind === 'completed' ? 'completed' : 'active', current_start: Math.floor(start.getTime() / 1000), current_end: Math.floor(end.getTime() / 1000) } };
  const needsPayment = i.kind === 'charged' || i.kind === 'payment_failed';
  const payment = needsPayment ? { entity: { id: i.paymentId ?? `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`, amount: i.amountMinor ?? 0, currency: 'INR', status: i.kind === 'charged' ? 'captured' : 'failed', method: 'card', ...(i.kind === 'payment_failed' ? { error_description: 'Payment declined by the bank' } : {}) } } : undefined;
  const event = i.kind === 'payment_failed' ? 'payment.failed' : `subscription.${i.kind}`;
  const payload = { entity: 'event', account_id: 'acc_mock', event, contains: payment ? ['subscription', 'payment'] : ['subscription'], payload: { subscription: sub, ...(payment ? { payment } : {}) }, created_at: Math.floor((i.createdAt ?? new Date()).getTime() / 1000) };
  return { body: Buffer.from(JSON.stringify(payload)), eventId };
}
