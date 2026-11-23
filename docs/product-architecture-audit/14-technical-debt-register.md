# 14 — Technical Debt Register

Rows are sorted by priority (P0 first), then impact, then ID. Scoring: **Impact** H/M/L (customer, security or delivery harm if left) · **Effort** in engineering days · **Priority** P0 (before first customer) → P3 (opportunistic). "Roadmap" links to doc 13. Evidence is file/line from this checkout (`main` @ `dce256d`) or a command I ran.

| ID | Debt | Evidence | Impact | Effort | Priority | Roadmap |
|---|---|---|:--:|---:|:--:|---|
| TD-01 | **Lint gate failing**: `eslint .` → 174 problems (164 errors; 122 `no-explicit-any`, 31 unused vars, react-hooks rules) despite policy "no `any`" | `eslint.config.mjs`; ran `eslint .`; worst: `soft-delete.ts` 31, `email-tracking.test.ts` 21, `roles-custom-unit.test.ts` 19, `campaigns-unit.test.ts` 18 | H | 3 | P0 | R0 |
| TD-02 | **No CD, no dependency/secret/SAST/container scanning, no coverage** | `.github/workflows/ci.yml` (two jobs only) | H | 3–4 | P0 | R0, R8 |
| TD-03 | **Scheduled-campaign sweep queries RLS table without tenant context** (likely never fires) | `campaigns.service.ts` `checkScheduledCampaigns`; policy `tenant_id = app_tenant_id()`; contrast `list_active_tenant_ids()` | H | 1.5 | P0 | R1 |
| TD-04 | **Campaign sender: send-then-persist, no lease, no idempotency key, jobId with `Date.now()`, no rate/quota handling** | `campaigns.service.ts:562-700`, `jobs.service.ts:97-103,176` | H | 6 | P0 | R2 |
| TD-05 | **Marketing eligibility ignores opt-in** (only `OPTED_OUT` excluded) | `campaigns.service.ts:405-436`; `inbound.service.ts:95-96` | H | 6 | P0 | R3 |
| TD-07 | **Google OAuth state unverified; body unvalidated; redirectUri from client; no permission** | `google-calendar.service.ts:92,123`; `google-calendar.controller.ts`; `google-calendar-card.tsx:62-68` | H | 2 | P0 | R5 |
| TD-08 | **No provider ever verified live** | `docs/live-verification.md` ("nothing … has been run"); prod compose "UNVERIFIED" | H | 10 | P0 | R6 |
| TD-09 | **No deployed/exercised environment, no recorded restore drill, no IaC** (only reference markdown) | `infrastructure/ecs-fargate-reference.md`, `scripts/backup-restore-drill.sh` | H | 10 | P0 | R8 |
| TD-06 | **Email tracking tenant-wide data behind `lead:*:own`; suppression writes by agents** | `email-tracking.controller.ts`; service takes `tenantId` only | M | 2.5 | P0 | R4 |
| TD-31 | **Google Calendar live path: no token refresh; credential read without tenant context; failures swallowed** | `google-calendar.service.ts:157,411-417`; `appointments.service.ts:282,303` | H | 3 | P1 | R10, P8 |
| TD-11 | **Only 36 FKs for 81 models**; `tenant_id` FK on ~6 tables; logical links unenforced (`GoogleCalendarSync.membershipId/credentialId`, `lead_id` on conversations/appointments/consents) | `grep FOREIGN KEY` across migrations | M | 6 | P1 | A1 |
| TD-12 | **Cross-tenant system sweeps are not tested on the app role** (RLS completeness itself *is* tested) | `rls-isolation.test.ts:74,100`; `campaigns.service.ts` `checkScheduledCampaigns` | M | 1 | P1 | A2 |
| TD-13 | **`ops/` god module** (30 files, 43 endpoints) and controllers declared in `*.module.ts` files | `apps/api/src/ops/`, `roles.module.ts` 307 lines, `ai.module.ts`, `channels.module.ts` | M | 8 | P1 | A3 |
| TD-15 | **Mutable callbacks wiring `JobsService` ↔ feature services; job silently skipped when unset** | `jobs.service.ts:47-53,99-101`; `campaigns.service.ts:67-77` | M | 2 | P1 | A4 |
| TD-16 | **Google Calendar HTTP inside DB tx; errors swallowed** | `appointments.service.ts:282,303` | M | 3 | P1 | A5 |
| TD-17 | **Two DB transactions per request; no permission cache; default pool; no `statement_timeout`** | `guards.ts` `TenantGuard`; `db.module.ts`; `packages/database/src/index.ts` | M | 4 | P1 | A6 |
| TD-19 | **No idempotency for internal side-effecting endpoints** | `emails/send`, `campaigns/:id/launch`, `conversations/:id/messages` | M | 3 | P1 | A8 |
| TD-25 | **SES message-id correlation unproven** | `email-tracking.service.ts:227-228,445-456`; `mail.module.ts` | M | 3 | P1 | R7 |
| TD-32 | **AI reply turns not durable**: in-memory debounce timers, executes in API tier, no unanswered-message sweeper; same mutable-callback pattern as jobs | `ai/orchestrator.ts:36,55,65-72`; `ai/ai-trigger.ts` | M | 3 | P1 | A11 |
| TD-33 | **`erase_lead()` not updated for tracked emails / engagement events** (DPDP gap) | `20261116230000_privacy_erasure`; `tracked_emails.lead_id` `SET NULL` | M | 1 | P1 | R11 |
| TD-10 | **Small exposures**: `/docs` always on; `/design/*` demo pages in prod; literal fallback secret in source; platform-admin MFA off by default (`PLATFORM_REQUIRE_MFA=false`) | `bootstrap.ts` `setupSwagger`; `app/design/**`; `email-tracking.service.ts:57`; `.env.example:137` | L | 1 | P1 | R9 |
| TD-14 | **Oversized services**: `email-tracking.service.ts` 976, `campaigns.service.ts` 814, `leads.service.ts` 486, `appointments.service.ts` 453, `automation-engine.ts` 419 | `wc -l` | M | 5 | P2 | A3, A9 |
| TD-18 | **Dual API-client strategy** (65 hand-written vs 2 generated) | grep of `api-generated` vs `lib/api` | M | 10 | P2 | A7 |
| TD-20 | **No coverage reporting; no contract fixtures from real providers; no E2E for newest modules; custom roles & campaigns unit-only** | `ci.yml`; `apps/api/test/*-unit.test.ts`; `e2e/tests` list | M | 4 | P2 | A10 |
| TD-21 | **Synchronous, row-capped CSV import (5,000) / export (50,000, built in memory)**; silent truncation beyond the cap | `lead-import.service.ts:15,179-193` | M | 5 | P2 | P9 |
| TD-23 | **Client-heavy web app; 500–800-line pages** (50/51 pages `'use client'`; `tasks/page.tsx` 799, `leads/page.tsx` 723) | `grep "use client"`, `wc -l` | M | 8 | P2 | Doc 12 §3 |
| TD-27 | **Unbounded append tables, no partitioning/retention for messages, events, AI runs** | schema; `docs/performance.md` caveat | M | 5 | P3 | S3 |
| TD-22 | **Build-phase scaffolding in product code** (`CURRENT_PHASE`, `phase`, "Soon") | `apps/web/lib/nav.ts` | L | 0.5 | P3 | – |
| TD-24 | **Redundant/unused columns and free-text status**: `sesMessageId`≈`smtpMessageId`; `GoogleCalendarSync.syncToken/channelId` unused; `status String` | `schema.prisma` TrackedEmail, GoogleCalendarSync | L | 1 | P3 | R7, P8 |
| TD-26 | **Public tracking endpoints unthrottled; spoofable IP; scanner-inflated metrics** | `tracking-pixel.controller.ts` | L | 1 | P3 | P2 |
| TD-28 | **Generated Prisma client committed** (89 files, 5.6 MB) causing 20k+ line diffs per schema change; risks stale generated code | `git ls-files packages/database/src/generated` | L | 1 | P3 | Decision needed (gitignore it; CI already runs `db:generate`) |
| TD-29 | **Documentation drift**: prior audit stale (265 endpoints, 32 permissions, "Orval hooks drive the frontend"); root `PROGRESS.md` (54 KB) and `MASTER_PROMPT.md` (29 KB) mix history with guidance; `docs/api-specification.md` likely behind new endpoints | file sizes; this audit | L | 2 | P3 | – |
| TD-30 | **Misleading scripts/comments**: per-package `lint` = `tsc --noEmit`; "rate-limit guard" comment on `dispatchBatch`; `apps/worker` is a README + package.json wrapper around code that lives in `apps/api` | `apps/*/package.json`, `campaigns.service.ts:561`, `apps/worker/` | L | 1 | P3 | R0 |

## Debt themes
1. **Velocity outrunning gates** (TD-01, 02, 20, 29): recent commits add 20k+ lines with failing lint and thin integration tests.
2. **New modules built on shortcuts** (TD-03–07, 14, 25, 26, 31, 33): they skip patterns established in older modules (Zod bodies, permission decorators, sweepers via `SECURITY DEFINER`, integration tests).
3. **Boundary erosion** (TD-13–15, 18, 32): the monolith is still healthy but boundaries are social, not enforced.
4. **Operational unknowns** (TD-08, 09, 11, 12, 17, 27): the platform has not met production reality.

## Effort summary
| Priority | Items | Effort (eng-days, summed from the table) |
|---|---:|---:|
| P0 | 9 | ~44 |
| P1 | 12 | ~38 |
| P2 | 5 | ~32 |
| P3 | 7 | ~12 |
| **Total** | **33** | **~126** |

The debt effort overlaps with the roadmap (doc 13) rather than adding to it; the roadmap's ~252 days also include new features (Phases 3–4).

## Payoff order
Phase 1 retires TD-01–10, TD-25, TD-31 and TD-33 (~50 days). Phase 2 retires TD-11–21 and TD-32. The remainder is opportunistic.
