# ADRs: Phase 3 (Communication)

## ADR-0013: WhatsApp webhooks are routed by an unguessable per-channel key and authenticated with the tenant's own app secret
**Context.** Tenants connect their own WhatsApp number, usually through their own Meta app (manual token entry, per ADR/assumption). The webhook payload names a `phone_number_id`, but that is attacker-controlled until the signature is checked, and each tenant's app has a different secret.
**Decision.** Each channel gets a webhook URL containing a 192-bit random key (`/webhooks/whatsapp/:key`). The key selects the channel (via a `SECURITY DEFINER` lookup) *before* any parsing; the HMAC-SHA256 signature (`X-Hub-Signature-256`) is verified over the **raw body** with that channel's decrypted app secret, in constant time; only then is JSON parsed. The payload's `phone_number_id` must equal the channel's, else it is ignored. The GET handshake uses a per-channel verify token. Identical redeliveries are dropped by a unique `(channel, sha256(body))` row; every message additionally has a unique `(channel, wamid)` so re-wrapped replays also dedupe.
**Consequences.** A leaked secret affects only its own tenant; no cross-tenant spoofing is possible even if the key leaks (the signature still fails). A failure after the signature check returns 500 so Meta retries; all writes are idempotent. Embedded Signup (platform-level app) will need a platform secret path (V1.1).

## ADR-0014: Website widget security model
**Context.** The widget runs on customers' websites and calls our API from the browser, so it cannot hold a secret.
**Decision.** The widget has a *public* key (`pk_…`) and an owner-maintained **allowed-origins list**. Widget endpoints reflect any origin at the CORS layer (no cookies are involved) but the service rejects any request whose `Origin` is not on that widget's list, including missing Origin. A visitor session is a short-lived signed token (7 days, audience `widget`) bound to the widget key, so rotating the key or disabling the widget revokes every session. One conversation exists per (widget, phone/email); a new session can only read messages created after it started, so knowing someone's phone number does not reveal their earlier chat. The loader renders in a Shadow DOM and inserts all text with `textContent`.
**Consequences.** `Origin` can be forged by non-browser clients, so the allow-list stops other *websites* from embedding the widget but not scripted abuse; that is bounded by per-IP rate limits (and bot protection in phase 7). Widget messages are fetched by polling (3 s) for now; SSE for visitors is a later optimisation.

## ADR-0015: Refresh-token reuse has a 10-second grace window
**Context.** Found during phase 3 browser testing: several tabs refreshing at the same instant with the same cookie looked like token theft and revoked the whole session family, logging users out at random.
**Decision.** Presenting a refresh token that was rotated less than 10 s ago is rejected with `refresh_race` (no revocation); the client waits briefly and retries (the sibling tab already received the new cookie). Reuse after the window revokes the family as before.
**Consequences.** Theft detection still works for any attacker who replays later than 10 s; an attacker replaying within 10 s of the victim's own refresh gets a 401 and no session.

## ADR-0016: Outbound sends are in-process with bounded retries until phase 5
**Context.** The brief calls for retries and rate-limit handling; BullMQ workers arrive in phase 5.
**Decision.** `send` stores the message as `QUEUED`, calls the provider outside the DB transaction, retries transient errors (network, 5xx, documented rate-limit codes) up to 3 attempts with short backoff, and records `SENT` or `FAILED` (with `retryable`/`retryAfterSec`). Failed messages can be retried manually. 24-hour window, opt-out and template rules are enforced server-side before any provider call.
**Consequences.** A slow provider holds the HTTP request (≤ ~35 s worst case). Scheduled background retries and dead-lettering move to the phase 5 worker.

## ADR-0017: Media is proxied on demand, not stored
**Decision.** Inbound media keeps only provider metadata; `GET …/media` fetches it from Meta with the tenant's token and streams it back (images inline, everything else forced download, `nosniff`, restrictive CSP, 16 MB cap, Meta-host allow-list). **Consequences.** Files disappear when Meta expires them (~30 days). Durable storage (and virus scanning) arrives with the document pipeline in phase 4.
