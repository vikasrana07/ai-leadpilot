# Local setup

Prerequisites: Node 22, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
# put real random values in .env:
#   JWT_ACCESS_SECRET=$(openssl rand -base64 48)   LOCAL_MASTER_KEY=$(openssl rand -base64 32)
pnpm infra:up          # Postgres(pgvector) :5433, Redis :6380, Mailpit UI :8026, MinIO :9100, ClamAV :3310 (non-default ports on purpose)
pnpm db:generate && pnpm build
pnpm db:migrate        # prisma migrate deploy (as owner role) + syncs the permission catalogue
pnpm db:seed           # optional, DEV ONLY: two demo workspaces (password printed by the script)
pnpm dev               # api :4000 (tsc --watch + node --watch), web :3100
```

Web: http://localhost:3100 · API docs/health: http://localhost:4000/health · Mail inbox (verification, invites, resets): http://localhost:8026
Design review screens (sample data, not connected): http://localhost:3100/design/inbox, `/design/lead`, `/design/pipeline`.

## Checks
```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @leadpilot/api build && pnpm --filter @leadpilot/api smoke   # boots the built API under plain Node
```
Tests need the infra running (they use the real Postgres through the **non-owner** `leadpilot_app` role, so RLS is exercised).

## Database roles
| Role | Used by | Notes |
|---|---|---|
| `leadpilot_owner` | migrations, permission sync, test cleanup | owns the schema; never used by the running API |
| `leadpilot_app` | API / worker (`DATABASE_URL`) | not superuser, not owner, no BYPASSRLS: every tenant policy applies |

## Environment variables
| Var | Purpose |
|---|---|
| `DATABASE_OWNER_URL` / `DATABASE_URL` | owner (migrations) / runtime (RLS-subject) connection strings |
| `POSTGRES_PASSWORD`, `APP_ROLE_PASSWORD`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT` | docker compose |
| `REDIS_URL` | reserved for Phase 5 (BullMQ, rate-limit store) |
| `API_PORT`, `WEB_ORIGIN` | API port; the single allowed browser origin (CORS + CSRF origin check) |
| `JWT_ACCESS_SECRET` | ≥32 chars, signs 15-min access tokens |
| `LOCAL_MASTER_KEY` | dev envelope-encryption key (used from Phase 3; prod uses KMS) |
| `SMTP_HOST/PORT`, `MAIL_FROM` | mail (Mailpit locally) |
| `NEXT_PUBLIC_API_URL` | API URL baked into the web build |
| `THROTTLE_AUTH_LIMIT`, `THROTTLE_GLOBAL_LIMIT`, `ENABLE_SWAGGER` | optional tuning |

The API refuses to start on missing/invalid variables (zod validation in `apps/api/src/config/env.ts`). `.env` is git-ignored.

## WhatsApp and the website widget (phase 3)

- `WHATSAPP_MODE=mock` (default in dev/tests) uses an in-memory provider: connecting a channel accepts any well-formed credentials and "sends" are recorded, not delivered. `live` talks to Meta's Graph API and is **required in production** (the API refuses to start with `mock` there).
- Try the full flow without Meta: with the API running, `node apps/api/scripts/demo-whatsapp.mjs` connects a mock number to the demo workspace and delivers correctly signed webhooks; open http://localhost:3100/inbox.
- Real WhatsApp needs a public HTTPS URL for the webhook (`PUBLIC_API_URL`, e.g. via a tunnel). In **Integrations → WhatsApp** enter the phone number ID, WABA ID, a permanent system-user token and the Meta app secret; the page then shows the callback URL and verify token to paste into Meta (WhatsApp → Configuration, subscribe to `messages`).
- Website widget: **Integrations → Website chat widget**, list the sites allowed to show it, then paste the generated `<script>` tag. For a local test, allow `http://localhost:3100` and inject the script into any page served from that origin.
- Redis must be running (`pnpm infra:up`): it carries real-time events from the API to browsers (SSE).

## AI, files and virus scanning (phase 4)

- `AI_PROVIDER=mock` (default) runs an **offline, rule-based stand-in**: it is not a language model but exercises every real component (tools, knowledge retrieval, guards, scoring, handover, usage caps). Set `AI_PROVIDER=openai` and `OPENAI_API_KEY` for a real model (**never verified: needs your key**). Production refuses to start with `mock`.
- Knowledge files go to S3-compatible storage (MinIO locally: `S3_*` variables; the bucket is created on startup) and are scanned by ClamAV (`VIRUS_SCAN_MODE=clamav`). ClamAV needs a minute or two to load signatures after `infra:up`; uploads are refused (fail closed) while it is unavailable. `mock` scanning is for tests only and refused in production.
- Demo: with the API running and an assistant enabled in **AI Assistant**, `node apps/api/scripts/demo-whatsapp.mjs` then `node apps/api/scripts/demo-ai.mjs` simulate customers chatting with it.
- Evaluation: `pnpm --filter @leadpilot/api exec vitest run test/eval.test.ts` runs the 26 offline golden conversations. `EVAL_LIVE=1 AI_PROVIDER=openai OPENAI_API_KEY=… pnpm --filter @leadpilot/api exec vitest run test/eval.test.ts` runs all 39 against a real model (cost: a few cents).
- Migrations that use pgvector need a role allowed to `CREATE EXTENSION vector`; `prisma migrate dev` therefore uses the Postgres superuser for its shadow database (`DATABASE_SHADOW_URL`).

## Background worker (phase 5)
Reminders, automations, notifications, SLA alerts and task due-dates are processed by a separate process. Without it they are recorded but never run.

```
pnpm --filter @leadpilot/api build
pnpm --filter @leadpilot/worker start      # same .env as the API
```
For single-process development set `WORKERS_ENABLED=true` instead. Run as many workers as you like. Reminders and automated WhatsApp messages need approved templates registered under Integrations (`welcome_lead`, `appointment_confirmation`, `appointment_reminder`, `no_show_followup`); until a template exists the message step is skipped and the run history says so.

## Billing and the platform console (phase 6)
**Local (default):** `RAZORPAY_MODE=mock` and `SIGNUP_PLAN=internal` give you an unmetered workspace. To try billing, set `SIGNUP_PLAN=growth` (new signups start a trial), open **Billing**, add billing details, choose a plan, and use the labelled *Test mode* buttons (they push signed, Razorpay-shaped events through the real webhook code).

**Platform console:** set `PLATFORM_JWT_SECRET` (`openssl rand -base64 48`), then create an admin as the schema owner (the app role cannot):
```
PLATFORM_ADMIN_PASSWORD='a-long-passphrase' pnpm --filter @leadpilot/database platform:create-admin you@company.com "Your Name"
```
Sign in at `/platform/login`. The console manages plans, tenants (suspend, complimentary plan, trial extension) and shows MRR.

**Live Razorpay (not yet verified; use TEST mode first):** create a Razorpay account, generate *test* API keys, set `RAZORPAY_MODE=live`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`; in Dashboard > Webhooks add `<PUBLIC_API_URL>/webhooks/razorpay` with a secret you also put in `RAZORPAY_WEBHOOK_SECRET`, events `subscription.*` and `payment.failed`. Set `SELLER_LEGAL_NAME`, `SELLER_GSTIN`, `SELLER_STATE_CODE`, `SELLER_ADDRESS`; confirm `INVOICE_SAC` with your accountant. Billing needs the worker process (grace expiry, trial notices and quota alerts run on its minute tick).

## Security hardening (phase 8)
**Master key (KMS).** By default secrets are wrapped with `LOCAL_MASTER_KEY`. For production set `KEY_PROVIDER=kms`, `KMS_KEY_ID` (key id or ARN) and `KMS_REGION`; the task role needs `kms:Encrypt` and `kms:Decrypt` on that key. Then move existing records: `DATABASE_OWNER_URL=... KEY_PROVIDER=kms KMS_KEY_ID=... node dist/scripts/rewrap-secrets.js --dry-run` (drop `--dry-run` to apply; keep `LOCAL_MASTER_KEY` set until it reports no `local-1` rows; idempotent). Rotating to a new KMS key: change `KMS_KEY_ID` and run the script again; old records stay readable meanwhile. **Never run against real KMS yet: see ADR-0007.**
**Bot protection.** Create a Cloudflare Turnstile widget, set `TURNSTILE_MODE=live`, `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY` on the API and build the web app with `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>`. For local testing use `TURNSTILE_MODE=mock` on the API and `NEXT_PUBLIC_TURNSTILE_SITE_KEY=mock` on the web build (the token is the literal `mock-pass`). Customers' websites that embed the chat widget must allow `https://challenges.cloudflare.com` in their own CSP when the check is live.
**Two-step verification.** Every user can turn on TOTP at **Security**; owners can require it for the whole workspace (members without it are held at that page). Platform admins enrol at `/platform/security`; set `PLATFORM_REQUIRE_MFA=true` to make it mandatory. Lost phone: a recovery code, or (support) an owner can have the user's `mfa_credentials` row removed by the schema owner after identity verification.


## Public API, webhooks, reports, support access (phase 8)
- **API keys / webhooks:** under *API keys* and *Webhooks* (owners; Growth and Premium). Docs: `GET <API>/v1/openapi.json`. Webhook receivers must be public HTTPS; for local development set `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` (ignored/rejected in production) to allow `http://127.0.0.1:…` receivers. Tuning: `API_KEY_RATE_LIMIT_PER_MIN` (120), `WEBHOOK_MAX_ATTEMPTS` (6), `WEBHOOK_BACKOFF_BASE_MS` (30000), `WEBHOOK_TIMEOUT_MS` (8000), `WEBHOOK_DISABLE_AFTER` (10). Webhook delivery runs in the worker process (the same loop that relays outbox events).
- **Reports:** *Reports & Analytics* (all roles; agents see only their own). CSV export needs the `csv_export` feature.
- **Support access:** platform console → workspace → *Support access* (needs the admin's password and a reason). Owners control it under *Settings → Support access*. Use a separate browser profile for support work.
