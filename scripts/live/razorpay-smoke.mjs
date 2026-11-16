// Verifies the LIVE Razorpay client against Razorpay TEST mode: plan creation, subscription creation, update (schedule at cycle end),
// cancel, and webhook signature verification. Usage:
//   RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=... node scripts/live/razorpay-smoke.mjs
// Refuses LIVE keys (rzp_live_*): this script creates and cancels real objects.
import { createHmac } from 'node:crypto';
import { check, finish, need } from './_lib.mjs';
need('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET');
if (!process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) { console.error('Refusing: use TEST-mode keys (rzp_test_...).'); process.exit(2); }
const { LiveBillingProvider } = await import('../../apps/api/dist/billing/provider.js');
const p = new LiveBillingProvider({ RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET });
console.log('Razorpay TEST-mode smoke');
let a, b, sub;
await check('create plan (monthly, INR, GST-inclusive amount)', async () => { a = await p.createPlan({ name: `LeadPilot smoke ${Date.now()}`, amountMinor: 589882, currency: 'INR' }); if (!/^plan_/.test(a.id)) throw new Error('unexpected id'); return a.id; });
await check('create a second plan (for the plan-change test)', async () => { b = await p.createPlan({ name: `LeadPilot smoke B ${Date.now()}`, amountMinor: 1179882, currency: 'INR' }); return b.id; });
await check('create subscription with a future start (trial-style)', async () => { sub = await p.createSubscription({ planId: a.id, tenantId: '00000000-0000-4000-8000-000000000000', startAt: new Date(Date.now() + 3 * 864e5) }); if (!/^sub_/.test(sub.id)) throw new Error('unexpected id'); return sub.id; });
await check('update subscription plan at cycle end (downgrade path)', () => p.updateSubscription(sub.id, { planId: b.id, changeAt: 'cycle_end' }).then(() => 'accepted'));
await check('cancel subscription at cycle end', () => p.cancelSubscription(sub.id, true).then(() => 'accepted'));
await check('webhook signature: accepts a correctly signed body', async () => { const body = Buffer.from('{"event":"subscription.activated"}'); if (!p.verifyWebhookSignature(body, createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex'))) throw new Error('rejected a valid signature'); });
await check('webhook signature: rejects a tampered body', async () => { const body = Buffer.from('{"event":"subscription.activated"}'); if (p.verifyWebhookSignature(Buffer.from('{"event":"subscription.activate"}'), createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex'))) throw new Error('accepted a tampered body'); });
console.log('\nManual steps still needed (cannot be scripted): (1) open Checkout with the subscription id using test card details from Razorpay docs; (2) point Dashboard > Webhooks at <PUBLIC_API_URL>/webhooks/razorpay and confirm `billing_events` rows appear with status processed; (3) compare a REAL `subscription.charged` payload with apps/api/src/billing/mock-events.ts and fix any field differences; (4) test a failed payment and an upgrade with schedule_change_at=now to see real proration.');
finish();
