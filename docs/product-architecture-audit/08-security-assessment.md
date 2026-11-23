# 08 — Security & Reliability Assessment

Defensive, static review. No exploitation was attempted and nothing was run against any system. Severity reflects impact × likelihood **in the code as written**; items marked [Inference] need a runtime check. Existing in-repo security material (`docs/security-review.md`, `docs/threat-model.md`, ADR 0006/0007) was read for context but findings below were re-derived from source.

## 1. Findings summary

| ID | Severity | Title | Status |
|---|:--:|---|---|
| S-01 | **High** | Campaign marketing sends ignore opt-in; only explicit `OPTED_OUT` is suppressed | Confirmed |
| S-02 | **High** | Campaign dispatch is not idempotent or leased; can double-send | Confirmed (design) |
| S-03 | **High** | Google Calendar OAuth callback has no `state` verification (account-linking CSRF) | Confirmed |
| S-04 | **High** | Scheduled campaigns likely never launch (RLS-blind sweep) | [Inference], high confidence |
| S-05 | Medium | Email-tracking API returns tenant-wide data and tenant-wide suppression control to `lead:*:own` users | Confirmed |
| S-06 | Medium | SES bounce/complaint correlation likely broken for SMTP-sent mail | [Inference] |
| S-07 | Medium | No live verification of any provider or deployed environment | Fact (docs) |
| S-08 | Medium | CI has no dependency, secret, SAST or container scanning; no CD | Confirmed |
| S-09 | Medium | Referential integrity relies on application code (36 FKs / 81 models) | Confirmed |
| S-10 | Medium | Google Calendar tokens/HTTP calls inside DB transactions; failures swallowed | Confirmed |
| S-18 | Medium | Platform super-admin MFA is not enforced by default (`PLATFORM_REQUIRE_MFA=false` in `.env.example`); console can start support sessions into any opted-in tenant | Confirmed |
| S-19 | Medium | Google Calendar live path likely non-functional: no token refresh; credentials read outside tenant context under RLS | [Inference], mock mode hides it |
| S-20 | Medium | DPDP lead erasure leaves tracked-email recipient and engagement data (IP, user-agent) | Confirmed |
| S-11 | Low | Tracking HMAC secret falls back to the JWT secret, then to a literal in source | Confirmed |
| S-12 | Low | Open/click endpoints unauthenticated, unthrottled, trust `x-forwarded-for` first hop | Confirmed |
| S-13 | Low | `/docs` Swagger UI and full OpenAPI exposed in every environment | Confirmed |
| S-14 | Low | Static `/design/*` demo pages served in production | Confirmed |
| S-15 | Low | Platform controller is fail-open by construction (mitigated by test) | Confirmed |
| S-16 | Low | `connect` endpoint body not schema-validated; client-supplied `redirectUri` | Confirmed |
| S-17 | Low (info) | No audit-log tamper evidence or export | Fact |

**Status 2026-11-24:** S-04 fixed (PR #2, confirmed by a failing-then-passing test); S-19 partly fixed (disconnect, PR #4); S-21–S-23 added (see `01-executive-summary.md`, Remediation status). All other findings are open. IDs are stable references used by other audit documents; the table is ordered by severity, not by ID. Counts: 4 High, 9 Medium (S-05–S-10, S-18–S-20), 6 Low (S-11–S-16), 1 informational (S-17).

No Critical findings. No SQL injection, XSS or tenant-isolation bypass was found in the areas inspected.

## 2. Findings in detail

### S-01 High — Campaigns ignore opt-in
- **Evidence:** `campaigns.service.ts:405-436` loads the latest `Consent` per lead and skips only `status === 'OPTED_OUT'`. `OPTED_IN` rows are created in exactly one place: `conversations/inbound.service.ts:95-96`, when a lead *messages us first*. Leads from CSV import, API (`POST /v1/leads`, `/api-keys/leads`), widget or manual entry have **no** consent row and are therefore eligible. The UI (`create-campaign-dialog.tsx`) only reports opt-out counts.
- **Impact:** WhatsApp Business policy requires opt-in for business-initiated marketing templates; violations lower the number's quality rating, cause template/number restriction or ban, and expose the tenant (and vendor as processor) under India's DPDP Act consent obligations. Customer-visible and potentially business-ending for the tenant's WhatsApp number.
- **Remediation:** treat absence of consent as ineligible for marketing categories; require explicit `OPTED_IN` with source/timestamp; add a consent ledger (doc 07 §5); show "ineligible: no opt-in" counts in preview; import flow gets a consent attestation field; block `MARKETING` templates to leads outside the 24-hour window unless opted in.

### S-02 High — Non-idempotent campaign dispatch
- **Evidence:** `dispatchBatch` (`campaigns.service.ts:562-700`) reads `PENDING` recipients with `findMany` (no claim), **sends first** via `wa.sendTemplate(...)`, then writes conversation/message/recipient/counters in a separate transaction. BullMQ jobs use `jobId: campaign:<id>:<Date.now()>` (`jobs.service.ts:176`, so no de-duplication) with `concurrency: 3` (`:103`). `launch()` reads status with no row lock or compare-and-set (`:384-399`).
- **Failure modes:** (1) send succeeds, DB tx fails or process dies → recipient remains PENDING → resent next batch. (2) Two jobs for one campaign (BullMQ retry after a crash, a manual relaunch race, a duplicate scheduled sweep) read the same PENDING rows → duplicates. (3) `unique(campaign_id, lead_id)` prevents duplicate recipient rows, so a double *launch* mostly fails with a constraint error, but double *dispatch* is not prevented.
- **Also:** no pacing relative to Meta throughput/tier limits, no 429/131056 handling, the comment "rate-limit guard" in the docstring is not implemented; no plan entitlement or metering.
- **Remediation:** claim rows atomically (`UPDATE … SET status='SENDING', claimed_at=now() WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING`), include an idempotency key (recipient id) in provider metadata, reconcile stuck `SENDING` by lease expiry, deterministic job id `campaign:<id>`, status CAS on launch, backoff on provider throttling, per-tenant daily cap from plan.

### S-03 High — Google OAuth callback lacks `state` check
- **Evidence:** `google-calendar.service.ts:92` builds a `state` (base64url JSON `{tenantId, membershipId, ts}`, **unsigned**) but `connect()` (`:123`) never receives or verifies it; the controller accepts only `{code, redirectUri?}` (`google-calendar.controller.ts`). The UI auto-submits any `?code=` found in the page URL: `google-calendar-card.tsx:62-68`.
- **Attack (static reasoning):** an attacker completes Google's consent for the app with their own Google account, stops at the redirect, and sends the logged-in victim the link `https://<app>/integrations?code=<attacker_code>`. The victim's browser posts the code; the victim's membership is bound to the **attacker's** calendar; subsequent `syncAppointment` pushes lead names/phones/appointment details to the attacker's calendar. CSRF origin middleware does not help because the request is a legitimate same-origin call from the app.
- **Remediation:** generate a random `state`, store server-side (Redis, 10 min TTL, bound to session+membership), require and compare on `connect`; sign if stateless; require PKCE; validate body with Zod; restrict `redirectUri` to the configured value; consider an `integration:manage` or dedicated permission; show which Google account is connected and require confirmation.

### S-04 High — Scheduled campaigns likely never launch
See doc 07 §4.7. `checkScheduledCampaigns` queries `broadcast_campaigns` through the RLS-bound runtime role without tenant context; every comparable sweep uses a `SECURITY DEFINER` helper. Remediation: `list_due_campaigns()` DB function; integration test on the real role.

### S-05 Medium — Email tracking authorization mismatch
- **Evidence:** `email-tracking.controller.ts` gates `stats`, list, detail, suppression list with `lead:read:own`, and add/remove suppression with `lead:write:own`; `EmailTrackingService` methods take only `tenantId` (`getStats(ctx.tenantId)`, `listTrackedEmails(ctx.tenantId, q)`, `addSuppression(ctx.tenantId, …)`); no owner/assignee filter exists in the service. By contrast leads, conversations, tasks and appointments scope to the member's own records.
- **Impact:** an agent restricted to their own leads sees every colleague's outbound email metadata (recipient addresses, subjects, engagement) and can **remove a suppression** (re-enabling sends to a hard-bounced or complaining address, risking SES account reputation) or add suppressions for others.
- **Remediation:** introduce `email:read:all|own` and `email:suppress:manage`; scope list/detail by `lead.assignedMembershipId` or `sentBy`; restrict suppression writes to managers; add the new rules to `security-matrix.test.ts`.

### S-06 Medium — Bounce correlation [Inference]
`MailService.sendCustom` (nodemailer SMTP transport) returns `res.messageId`, which is the RFC 5322 `Message-ID` that nodemailer generated. `sendTrackedEmail` stores it as both `sesMessageId` and `smtpMessageId` (`email-tracking.service.ts:227-228`). SNS delivery/bounce/complaint notifications identify the mail by SES's own message id (`mail.messageId`), matched by `OR [{sesMessageId}, {smtpMessageId}]` (`:445-448`). With the SES SMTP interface these are normally different identifiers, in which case events log "unmatched message" (`:456`), **hard bounces and complaints will never create suppressions**, and delivery status stays SENT. Remediation: run the SES sandbox test from `docs/live-verification.md`; if confirmed, send through the SES API (`@aws-sdk/client-sesv2` returns the SES id) or set a configuration-set tag/custom header and match on it.

### S-07 Medium — Never exercised live
`docs/live-verification.md`: "Status (2026-11-16): nothing in this document has been run." Includes WhatsApp, OpenAI, Razorpay, SMTP, Embedded Signup; `docker-compose.prod.example.yml` is "UNVERIFIED as a whole". KMS, Turnstile and SES/SNS likewise. Webhook signature, payload shape and ordering assumptions are therefore untested against real traffic.

### S-08 Medium — Supply chain and delivery
`.github/workflows/ci.yml` runs install → generate → build → migrate → lint → typecheck → test → smoke, plus E2E. Also, `pnpm lint` (root `eslint .`) currently fails with 164 errors (doc 10 §0), so the `verify` job should be red. Absent: `pnpm audit`/Dependabot/Renovate, secret scanning, CodeQL/Semgrep, container image scan, SBOM, coverage upload, deployment workflow, environment protection. Dependency set includes very new major versions (Next 16, React 19.3, NestJS 12, TypeScript 6, Zod 4, vitest 5) which increases exposure to young-release defects.

### S-09 Medium — Integrity
36 FKs across 81 models (doc 07 §4.1). Security relevance: orphaned PII after partial deletes, defence-in-depth gap beyond RLS (a buggy service could attach a row to another tenant's `lead_id` and RLS `WITH CHECK` only validates `tenant_id`, not the referenced parent's tenant).

### S-10 Medium — External I/O inside DB transactions (see also S-19)
`appointments.service.ts:282,303` pass the open `tx` into `gcal.syncAppointment` and discard errors with `.catch(() => null)`. Network stalls hold DB connections; failures leave calendars out of sync silently; token refresh failures are not surfaced.

### S-18 Medium — Platform-admin MFA optional by default
the platform console can suspend tenants, change plans and open time-boxed read-only support sessions. `platform-auth.ts:45-46` blocks admins without MFA only when `PLATFORM_REQUIRE_MFA` is true; the shipped example env disables it. Related safety flags with insecure-capable values exist (`ALLOW_LOCAL_KEY_IN_PRODUCTION`, `TURNSTILE_ALLOW_OFF_IN_PRODUCTION`). **Remediation:** default to enforced in production, fail boot in `NODE_ENV=production` if any of the three relaxations is set without an explicit acknowledgement, and add the check to the launch checklist.


### S-19 Medium — Google Calendar live path likely non-functional
`google-calendar.service.ts` stores the access token and `expiresAt` but nothing ever exchanges the refresh token (only `grant_type: 'authorization_code'`, L157), so free/busy and event pushes would fail about an hour after connecting. Separately, `getDecryptedTokens` (L411-417) calls `this.db.prisma.integrationCredential.findUniqueOrThrow` with no `app.tenant_id`; `integration_credentials` has a `tenant_isolation` policy (`20261116190000_communication_rls`), so under the app role the row is invisible and the call throws; `appointments.service.ts:282,303` swallow it. Free/busy takes the tenant-scoped path and would only hit the expiry problem. Mock mode skips both, so tests pass. **Remediation:** pass the `tx` through, refresh tokens with expiry check and persist the new token, surface `status='error'` on the card, and add a live-mode test against RLS.


### S-20 Medium — DPDP erasure misses email data
`erase_lead(p_tenant, p_lead)` is a fixed list of deletes (last defined in `20261116230000_privacy_erasure`). It was not extended for `tracked_emails` / `email_engagement_events`, whose `lead_id` FK is `ON DELETE SET NULL`. After an erasure request the person's email address and engagement trail persist. **Remediation:** add both tables to `erase_lead` in a new migration (`CREATE OR REPLACE`), add an erasure test per tenant table that references a lead, and make `erase_lead` fail a CI check when a table with `lead_id` is unhandled.


### Low items
- **S-11:** `email-tracking.service.ts:57` `TRACKING_SECRET || JWT_ACCESS_SECRET || '<hard-coded literal>'`. The literal is unreachable while `JWT_ACCESS_SECRET` is required (≥32 chars) but is a secret-shaped literal in source and the fallback reuses the session-signing key for a different purpose. Require `TRACKING_SECRET` and delete the literal.
- **S-12:** `tracking-pixel.controller.ts` is `@Public() @SkipThrottle()`; it records `x-forwarded-for`'s first value (client-controlled) instead of Express `req.ip` (the app sets `trust proxy` = 1). Valid tokens are required (HMAC), so abuse is limited to holders of a token; email security scanners will inflate opens/clicks (product accuracy, not security).
- **S-13:** `bootstrap.ts` `setupSwagger` is unconditional → `/docs` and `/docs-json` list all 291 routes including `/platform/*` in production. Gate by env or auth.
- **S-14:** `apps/web/app/design/**` ships hard-coded demo pages in production builds.
- **S-15:** see doc 06 API-3.
- **S-16:** `connect` body typed inline, not a Zod schema; `redirectUri` accepted from the client.
- **S-17:** audit log is partitioned and append-only by grants, but no hash chaining/export; enterprise buyers often require both.

## 3. Control-by-control review

| Area | Assessment | Evidence |
|---|---|---|
| Authentication | Strong. argon2id hashing, short-lived access JWT + rotating refresh, server-side session revocation checked each request (Redis-cached), httpOnly + SameSite=Lax cookies with `secure` flag, per-route throttles, Turnstile on register/login/forgot/portal/widget | `auth/`, `guards.ts`, `auth.controller.ts:38-40` |
| MFA | TOTP + recovery codes, throttled, workspace policy `requireMfa`. Platform-admin MFA is **opt-in**: enforced only if `PLATFORM_REQUIRE_MFA=true`, and `.env.example` sets it to `false` (S-18) | `mfa/`, `TenantGuard`, `platform-auth.ts:45-46`, `.env.example:137` |
| Session mgmt | List/revoke sessions, switch workspace re-issues claims | `auth.controller.ts` |
| RBAC | 41 permissions, 3 system + custom roles, server-side enforcement, escalation guards on role create/update and member role change | `roles.module.ts`, `team.service.ts:117` |
| Tenant isolation | RLS + guards + tests (doc 07). Support access is read-only, time-boxed, tenant opt-in, audited | `support/` |
| Input validation | Zod at the edge; `ParseUUIDPipe`; CSV parsing bounded? [not verified] | |
| SQL injection | Prisma parameterised queries; raw SQL via tagged templates; `$executeRawUnsafe` only for constant `SAVEPOINT` strings (`leads.service.ts:350-352`) | grep |
| XSS | React escaping; `dangerouslySetInnerHTML` only for nonce'd theme-init scripts; nonce CSP + tests; API `Content-Security-Policy` via Helmet. Tracked-email HTML is rewritten by regex (`instrumentHtml`); sender-authored HTML is the user's own content | `middleware.ts`, `csp.ts` |
| CSRF | Origin/Referer check for cookie-authenticated unsafe methods (missing origin ⇒ 403) + SameSite=Lax | `common/middleware.ts:27-38` |
| CORS | Allow-list of `WEB_ORIGIN` with credentials; widget routes `*` without credentials; tested | `bootstrap.ts`, `security-matrix.test.ts` |
| Secrets | Envelope encryption (`SecretBox`, KMS or local AES-GCM with a production guard `ALLOW_LOCAL_KEY_IN_PRODUCTION`), secrets never returned by API (tested). `.env` is git-ignored and not tracked (verified `git ls-files .env` = 0) | `.gitignore`, `crypto/` |
| Sensitive data exposure | Test asserts no hashes/tokens in responses; errors do not leak stack/SQL | `security-matrix.test.ts` |
| File upload | Size limit, ClamAV scan, S3 storage, async processing; MIME/type allow-list not verified in this review | `knowledge.controller.ts`, `scanners.service.ts` |
| SSRF | `safe-http.ts` blocks private ranges for outbound webhooks; WhatsApp media URL allow-list tested; SNS cert URL host-pinned (`sns.*.amazonaws.com`, https, `.pem`) | `safe-http.ts`, `sns-validator.ts` |
| API abuse | Global + per-route throttles, API-key rate limits, bot protection; tracking endpoints and webhooks not throttled | |
| Audit logging | `AuditService` on sensitive mutations; campaign/role/support actions audited; partitioned; platform audit separate | |
| Backup / DR | `scripts/backup-restore-drill.sh`, runbook `database-backup-restore.md`; **no recorded drill result** and no multi-region plan | [Unverified] |
| Dependencies | Lockfile present; no automated vulnerability scanning (S-08) | |
| Error leakage | Structured errors; request id | tested |
| Webhook authenticity | Razorpay HMAC raw-body, Meta signature, SNS signature verification | `billing.controller.ts`, `sns-validator.ts` |
| Privacy | Export/erase/retention/workspace deletion with grace; Meta deauth/data-deletion callbacks; erase coverage of new tables not verified | `privacy/`, `lifecycle/` |

## 4. Reliability observations

| Topic | Observation |
|---|---|
| Delivery semantics | Core flows are at-least-once with idempotent handlers (outbox claim by `SKIP LOCKED`, automation run CAS claim, Razorpay event de-dup). Campaign and email sends are the exceptions (S-02). |
| Retry/backoff | Webhooks (exponential, auto-disable), automations (`AUTOMATION_MAX_ATTEMPTS`), outbox (`fail_outbox` with delay). Campaign failures are terminal (`FAILED`), no retry. |
| Single points of failure | Redis, Postgres primary, SMTP provider, one maintenance scheduler (lock-protected). |
| Graceful shutdown | `enableShutdownHooks`, `onApplicationShutdown` closes workers/queues. |
| Health | `/health`, `/health/ready` (db + redis), worker heartbeat, alert rules, external probe script; SLO doc present. No deployed monitoring to confirm. |

## 5. Prioritised remediation

1. S-03, S-05, S-16 (authz/OAuth; ~3 days).
2. S-01, S-02, S-04 (campaign correctness and compliance; ~8–10 days).
3. S-06 + S-07 (live verification incl. SES; ~5–10 days elapsed, Meta lead times).
4. S-08 (pipeline hardening; ~3 days).
5. S-09, S-10 (integrity and transaction hygiene; ~8–10 days).
6. Low items (~2 days).
