# Real-provider verification kit

**Status (2026-11-16): nothing in this document has been run.** Every integration below was built against the provider's documented API and verified only with mocks. These scripts and checklists are how you turn "unverified" into "verified", one provider at a time. They import the **compiled production classes** (`apps/api/dist`), so run `pnpm build` first. Secrets come from the environment and are never printed.

| Provider | Script | What you need | Cost / risk |
|---|---|---|---|
| Razorpay (test mode) | `scripts/live/razorpay-smoke.mjs` | Razorpay account, **test** key id/secret, a webhook secret | free; refuses `rzp_live_*` |
| WhatsApp Cloud API | `scripts/live/whatsapp-smoke.mjs` | Meta developer app, WhatsApp test number, permanent/temporary access token, a recipient allowed in the sandbox | free in sandbox; sends at most one message |
| OpenAI | `scripts/live/openai-smoke.mjs` then `EVAL_LIVE=1 pnpm --filter @leadpilot/api eval` | API key | a few cents / a few dollars for the full eval |
| Email (SMTP) | `scripts/live/smtp-smoke.mjs` | SES/Resend SMTP credentials, verified sender domain | one email |

Each script prints PASS/FAIL per check and a list of **manual steps that cannot be scripted**. Do the manual steps too: a script passing proves the client calls work, not that webhooks reach you.

## Order I recommend
1. **OpenAI** (cheapest, biggest unknown): `node scripts/live/openai-smoke.mjs`, then the live eval. Read the Hinglish reply yourself. Record p50/p95 in `docs/performance.md` (the budget is a customer-visible reply p95 < 8 s including the 1.2 s debounce and the WhatsApp send).
2. **Razorpay test mode**: run the script, then the manual steps (checkout with a test card, webhook to a public URL via a tunnel such as cloudflared/ngrok, compare a real `subscription.charged` payload with `apps/api/src/billing/mock-events.ts`). Fix any field mismatch in `billing.service.ts` and add the real payload as a test fixture.
3. **WhatsApp**: run the script with your sandbox number, then the manual steps. Meta requires business verification and template approval for production: start that early, it takes days.
4. **SMTP**: run the script; check SPF/DKIM/DMARC; then trigger the real verification and invite emails.

## WhatsApp Embedded Signup (ADR 0012): items to verify with a real Meta test business
Nothing here has been run. With `EMBEDDED_SIGNUP_MODE=live` and a registered Tech Provider app, verify: the code exchange (`POST /oauth/access_token`: does it need `redirect_uri`? token lifetime?), `GET /{waba}/phone_numbers` containing the connected number, `POST /{waba}/subscribed_apps` and that inbound messages and statuses then arrive at `POST /webhooks/whatsapp` signed with the platform secret, whether a phone PIN registration is required, `DELETE /{waba}/subscribed_apps` on disconnect, the Embedded Signup pop-up message shape (milestone 2), the Facebook hosts needed in the CSP (milestone 2 added a best-guess list in `apps/web/next.config.ts`: check the browser console for blocked requests), that the SDK login callback delivers `authResponse.code` and the pop-up posts `WA_EMBEDDED_SIGNUP` with `FINISH`, `CANCEL` and error events with the field names `lib/embedded-signup.ts` expects, and the deauthorize and data-deletion callbacks (milestone 3). Record real payloads as test fixtures.

## What to expect to break (be suspicious here)
- Razorpay: whether a subscription with a future `start_at` emits `activated` at authentication or at first charge; proration on `schedule_change_at: now`; the exact `subscription.pending`/`halted` semantics; whether `cancel_at_cycle_end` sends `cancelled` immediately.
- WhatsApp: template parameter formats, the 24-hour window edge cases, status webhook ordering, media URL hosts (the SSRF allow-list covers `facebook.com`, `fbcdn.net`, `whatsapp.net`).
- OpenAI: strict-schema tool calling on your chosen model, token costs per conversation (re-check `docs/unit-economics.md` and plan quotas with real numbers), the output guards rejecting valid replies (watch `ai_runs.trace` for `unsupported_time` and price/URL guard hits).
- SMTP: mail marked as spam without SPF/DKIM.

## After a provider passes
Update `PROGRESS.md` (date, mode/sandbox, what exactly was exercised), the "Not verified" lines in the relevant ADR, `docs/security-review.md`/`launch-checklist.md`, and set the production env (`RAZORPAY_MODE=live`, `WHATSAPP_MODE=live`, `AI_PROVIDER=openai`) only after the sandbox pass.
