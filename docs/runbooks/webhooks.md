# Webhooks (WhatsApp, Razorpay, customer webhooks, outbound messages)

> **Alerts that point here:** `whatsapp_unprocessed` (received WhatsApp events not processed for over 5 minutes), `outbound_messages_failing`, `webhook_deliveries_failing` (customer endpoints; check the delivery log before assuming a platform fault).

The first two (WhatsApp and Razorpay) are public inbound endpoints and authenticate by HMAC over the **raw request body**. Anything that alters the bytes in front of the API (a proxy that re-serialises JSON, a WAF that rewrites bodies) breaks signatures.

## WhatsApp, platform app (Embedded Signup): `POST /webhooks/whatsapp`, handshake `GET /webhooks/whatsapp` (ADR 0012)
One URL for every Facebook-connected number; 404 while `EMBEDDED_SIGNUP_MODE=off`. Signature: HMAC-SHA256 with the **platform** `META_APP_SECRET`. Handshake token: `META_WEBHOOK_VERIFY_TOKEN`. Each change is routed to its workspace by `phone_number_id`; the response says `{status, processed, ignored}`.
| Symptom | Meaning / action |
|---|---|
| 401 `invalid_signature` for every delivery | `META_APP_SECRET` in the environment is not the platform app's secret (after a rotation, or a wrong environment), or a proxy rewrote the body. This affects ALL Facebook-connected numbers at once. |
| Handshake 403 | `META_WEBHOOK_VERIFY_TOKEN` differs from the token configured in the Meta app. |
| `ignored` with `processed: 0` | The number is unknown, its channel is disabled, or it belongs to a manually connected channel (those use their own URL and secret). Log line: "Platform webhook: N change(s) were not for an active Facebook-connected channel". |
| One workspace silent, others fine | Check its channel in Integrations (status, mode `platform`) and that the app is still subscribed to its WABA. Reconnect with Facebook. |
Account notices (`account_update` with a removal or uninstall event) arrive on this same endpoint: the channels of that WABA become `NEEDS_RECONNECT` and the owners are notified. A channel that keeps showing "Reconnect needed" after the owner reconnected means the Embedded Signup run failed: check the connect call's error and `audit_logs` (`integration.whatsapp_connected_embedded`, `integration.whatsapp_needs_reconnect`, `integration.whatsapp_recovered`). The daily health check log lines are under `ChannelHealth`.
To tell the modes apart: `SELECT config->>'mode' FROM channels WHERE id = ...` (`platform` or empty/`manual`).

## WhatsApp (Meta), manual connection: `POST /webhooks/whatsapp/:key`, handshake `GET /webhooks/whatsapp/:key`
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

## Outbound WhatsApp messages failing (alert `outbound_messages_failing`)
Ten or more outbound messages ended `FAILED` in the last hour (`messages.direction='OUTBOUND'`, `status='FAILED'`; the error is in `messages.error`).
```sql
-- Which workspaces and why (error is JSON; look at its code/message)
SELECT tenant_id, count(*) AS failed, max(created_at) AS latest, (array_agg(error ORDER BY created_at DESC))[1] AS latest_error
FROM messages WHERE direction='OUTBOUND' AND status='FAILED' AND created_at > now() - interval '1 hour'
GROUP BY tenant_id ORDER BY failed DESC;
```
- **One workspace, the rest fine:** that workspace's channel credentials (expired or revoked token), a template that is not approved, an opted-out customer, or the 24-hour window. Tell the workspace owner; nothing is wrong with the platform.
- **Many workspaces at once:** the WhatsApp provider is failing or rate-limiting. Check the provider's status page, then the API log for the send errors (`Failed to send`). Sends from the inbox can be retried by hand once the provider recovers; automation sends are retried by their run.
- The live WhatsApp client has never run against Meta (see `docs/launch-checklist.md`), so treat real provider error shapes as unverified.

## Customer webhooks (the product's outbound signed webhooks) (alert `webhook_deliveries_failing`)
Delivery is DB-driven: the dispatcher claims `webhook_deliveries` rows (`PENDING`, `next_attempt_at` due) and posts them to the customer's URL with exponential backoff. A delivery ends `DELIVERED` or `FAILED` (after `WEBHOOK_MAX_ATTEMPTS`). After `WEBHOOK_DISABLE_AFTER` consecutive failed deliveries the endpoint is switched off automatically and the workspace owners are notified (title "A webhook endpoint was switched off"). The alert fires when **any** of these is true: a `PENDING` delivery is more than 10 minutes past its next attempt (the dispatcher is not running), 20 or more deliveries failed in the last hour, or any endpoint is disabled.
```sql
-- Dispatcher stalled? PENDING deliveries long past due (should be none)
SELECT count(*), min(next_attempt_at) FROM webhook_deliveries WHERE status='PENDING' AND next_attempt_at < now() - interval '10 minutes';
-- Which endpoints are failing (counts per endpoint, last hour)
SELECT e.tenant_id, e.id AS endpoint_id, split_part(e.url,'/',3) AS host, e.enabled, e.disabled_reason, e.consecutive_failures,
       count(*) FILTER (WHERE d.status='FAILED') AS failed_last_hour, (array_agg(d.last_error ORDER BY d.created_at DESC))[1] AS latest_error
FROM webhook_endpoints e LEFT JOIN webhook_deliveries d ON d.endpoint_id = e.id AND d.created_at > now() - interval '1 hour'
GROUP BY e.id ORDER BY failed_last_hour DESC LIMIT 20;
-- Disabled endpoints and why
SELECT tenant_id, split_part(url,'/',3) AS host, disabled_reason, updated_at FROM webhook_endpoints WHERE enabled = false ORDER BY updated_at DESC;
```
- **Pending deliveries past due:** the dispatcher is not running. This is a worker problem: follow [worker-and-queues.md](worker-and-queues.md).
- **Failures concentrated on one endpoint:** a customer receiver problem (the usual cause). The `last_error` says whether it was a timeout, a non-2xx status or a blocked address (the sender refuses private and internal addresses by design). Nothing to fix on the platform; the workspace owner was notified and can re-enable the endpoint under Webhooks after fixing the receiver.
- **Failures across many endpoints at once:** suspect the platform (outbound network or DNS from the worker, a deploy that changed signing). Check the worker's outbound connectivity and recent releases.
- The alert counts only endpoints the dispatcher switched off **automatically** (`disabled_reason` starts with `Switched off automatically after N consecutive failed deliveries`). An endpoint a team member switched off on purpose (`Switched off by a team member`) does not count and does not keep the alert firing (fixed in migration `20261118100000_ops_snapshot_auto_disabled_only`).

