# Billing incidents

> **Alert that points here:** `billing_events_attention` (a billing event failed or unprocessed for over 15 minutes). Start with the `billing_events` query below.

Source of truth for state is the webhook from Razorpay; the app never activates a plan from the browser. Tables: `subscriptions` (per tenant), `invoices`, `payments`, `billing_events`, `invoice_counters`. Statuses: TRIALING, ACTIVE, PAST_DUE (grace), CANCELED (access to period end), EXPIRED (read-only).

## Customer paid but plan not active
```sql
SELECT status, plan_key, pending_plan_key, provider_subscription_id, current_period_end, grace_ends_at FROM subscriptions WHERE tenant_id='<tenant-id>';
SELECT received_at, type, status, error FROM billing_events ORDER BY received_at DESC LIMIT 30;
```
1. Is the event in `billing_events`? No: webhook not reaching us ([webhooks.md](webhooks.md): URL, secret, firewall). Redeliver from the Razorpay Dashboard once fixed.
2. `failed`: fix cause; redelivery reprocesses. `ignored` (`stale`/`unknown subscription`): the customer may have started a second checkout; the live subscription id is `subscriptions.provider_subscription_id`.
3. If the customer is blocked and it will take time: grant a stop-gap from the platform console (Tenants > plan > complimentary, with a reason). It is refused (409) while a live paid subscription exists.

## Missing or duplicate invoice
- Invoices are created only from a captured payment, once per provider payment id (duplicates cannot occur: `payments.provider_payment_id` and `invoices.provider_payment_id` are unique). A "duplicate" is usually two real payments: check `payments`.
- Missing: find the payment (`SELECT * FROM payments WHERE tenant_id='<id>' ORDER BY created_at DESC`). If the charge event never arrived, redeliver it. **Invoices are immutable and numbers are gap-free per financial year; never edit or delete one.** A correction needs a credit note process agreed with your accountant (not built).

## Wrong plan or limits
`subscriptions.plan_key` (effective) vs `pending_plan_key` (downgrade scheduled for the next renewal). Plan limits are rows in `plan_entitlements`; edit in the console (Plans), effective immediately for all subscribers of the plan.

## Payments failing / customer in grace or read-only
PAST_DUE keeps everything working until `grace_ends_at` (`BILLING_GRACE_DAYS`); then read-only (HTTP 402 on writes; reads, export and billing still work; nothing deleted). A successful payment restores access immediately. The minute scanner records the lapse and notifies owners once.

## Razorpay outage or wrong keys
Checkout fails with 502 `payment_provider_*`. Existing customers are unaffected. Check `RAZORPAY_MODE=live`, key id/secret. **The live Razorpay client has not been verified against Razorpay**; expect to debug request shapes on first live use.

## Reconciliation (monthly)
Compare Razorpay settlements with `SELECT date_trunc('month', issued_at), count(*), sum(total_minor)/100.0 FROM invoices GROUP BY 1 ORDER BY 1;`.
