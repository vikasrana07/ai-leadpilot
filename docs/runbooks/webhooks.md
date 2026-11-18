# Webhooks (WhatsApp, Razorpay)

> **Alerts that point here:** `whatsapp_unprocessed` (received WhatsApp events not processed for over 5 minutes), `outbound_messages_failing`, `webhook_deliveries_failing` (customer endpoints; check the delivery log before assuming a platform fault).

Both endpoints are public and authenticate by HMAC over the **raw request body**. Anything that alters the bytes in front of the API (a proxy that re-serialises JSON, a WAF that rewrites bodies) breaks signatures.

## WhatsApp (Meta): `POST /webhooks/whatsapp/:key`, handshake `GET /webhooks/whatsapp/:key`
The `:key` is a per-channel unguessable key (shown in Integrations). Signature header `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 with that channel's **app secret**.

| Symptom | Meaning / action |
|---|---|
| Meta shows 401 on delivery | `invalid_signature` (log line: `Rejected webhook with a bad signature for channel <id>`): wrong app secret saved on the channel, or body altered by a proxy. Re-save the app secret in Integrations; check no proxy rewrites bodies. |
| 401 `unknown_channel` | Key in the callback URL is wrong/rotated, or channel deleted. Re-copy the URL from Integrations. |
| Handshake fails (403 `verification_failed`) | Verify token mismatch. Re-copy it from Integrations. |
| 200 `{"status":"ignored"}` | Channel not ACTIVE, payload not a `messages` change, or addressed to a different phone number id. Check channel status and `phone_number_id`. |
| 200 `duplicate` | Identical delivery already recorded (de-dup by body hash). Normal on Meta retries. |
| 500 | Processing failed; the recorded delivery is deleted so Meta's retry is processed (all writes are idempotent). Find the error in the API log (`Webhook processing failed:`). |
| Messages missing though Meta says delivered | See below. |

```sql
-- Recent deliveries for a tenant (payload is stored; status received|processed)
SELECT created_at, status, left(payload::text, 200) FROM webhook_events WHERE tenant_id='<tenant-id>' ORDER BY created_at DESC LIMIT 20;
-- Deliveries recorded but never marked processed (process died mid-handling): older than 5 minutes
SELECT id, tenant_id, channel_id, created_at FROM webhook_events WHERE status='received' AND created_at < now() - interval '5 minutes';
```
**Known gap:** a `received` row left by a crash makes Meta's redelivery look like a `duplicate`, so that message would be dropped. There is no replay tool. Mitigation today: delete the stale row (`DELETE FROM webhook_events WHERE id='<id>'`, owner role) and ask the tenant to have the customer resend, or re-ingest by hand. (Unverified against real Meta retries; the live client has not run against Meta.)

Template/delivery status updates also arrive here (`statuses`); a failed send shows on the message (`messages.status`, `error`) and is resent manually from the inbox.

## Razorpay: `POST /webhooks/razorpay`
Header `X-Razorpay-Signature` = HMAC-SHA256(raw body, `RAZORPAY_WEBHOOK_SECRET`); `X-Razorpay-Event-Id` de-duplicates. Responses: 200 `processed|ignored|duplicate`, 401 bad signature, 5xx = Razorpay should retry.
```sql
SELECT received_at, type, status, error FROM billing_events ORDER BY received_at DESC LIMIT 50;
SELECT * FROM billing_events WHERE status IN ('failed','received') AND received_at < now() - interval '5 minutes';
```
- `failed`: processing threw; Razorpay's retry reprocesses it (handlers idempotent). If the cause was a bug, deploy the fix and use the Razorpay Dashboard to redeliver; the `failed` row is re-applied on the next delivery of the same event id.
- `ignored` with `unknown subscription` / `stale subscription`: event for a subscription we do not hold (or an older one). Usually harmless; investigate only if a customer reports payment without activation ([billing-incident.md](billing-incident.md)).
- 401s: secret mismatch between Dashboard and `RAZORPAY_WEBHOOK_SECRET`.
- Webhook URL to register: `<PUBLIC_API_URL>/webhooks/razorpay`, events `subscription.*` and `payment.failed`.
