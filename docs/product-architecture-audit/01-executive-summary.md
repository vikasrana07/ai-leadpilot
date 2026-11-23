# 01 — Executive Summary

**Audit date:** 2026-11-23 · **Repository state:** `main` @ `dce256d` (supersedes the audit committed in `567630c`, which predates the campaigns, email-tracking, Google Calendar, custom-role and worker-tier work)
**Method:** static inspection of source, migrations, tests, CI and docs. I ran only read-only checks (typecheck, eslint, web and API unit tests); nothing was executed against a database, provider or browser. Labels used throughout: **[Fact]** verified in code · **[Inference]** reasoned from code · **[Unverified]** could not be confirmed · **[Rec]** recommendation.

## 1. What the product is

**LeadPilot** is a multi-tenant B2B SaaS for lead capture, qualification and follow-up, built for Indian SMEs that sell through WhatsApp: real estate first, with industry packs for coaching, healthcare and home services (`packages/shared-types/src/industry-packs.ts`, ADR 0011). It combines:

- a CRM (leads, pipeline, tasks, properties, custom fields),
- a shared WhatsApp + web-chat inbox with AI auto-reply, knowledge base (pgvector) and lead scoring,
- appointments with double-booking protection and one-way Google Calendar push,
- a rule + graph automation engine,
- outbound channels: WhatsApp template **broadcast campaigns** and **tracked email** (new since the last audit),
- SaaS plumbing: RBAC with custom roles, MFA, audit log, Razorpay billing with GST invoices, public REST API + signed webhooks, a lead self-service portal, a platform super-admin console, DPDP-oriented data export/deletion.

## 2. Scale of what exists (measured by script on this checkout)

| Item | Count | Note |
|---|---:|---|
| API endpoints (decorator scan) | ~291 | regex count; some controllers share a file, treat as ±5 |
| Prisma models / enums | 81 / 28 | `packages/database/prisma/schema.prisma` |
| SQL migrations | 41 | `migrations/` (+ `migration_lock.toml`) |
| Permission keys | 41 | `packages/shared-types/src/permissions.ts` (old audit said 32) |
| Web `page.tsx` routes | 51 | 28 in `(app)`, 6 `(auth)`, 9 `/platform`, 4 `/design`, 4 public/other |
| API test cases (`apps/api/test`) | ~689 | vitest |
| Web unit cases / E2E cases | ~86 / 60 (19 Playwright specs) | |
| API source (non-generated) | ~17.7k LOC | web ~44k LOC incl. generated client |

## 3. Overall assessment

**An unusually disciplined codebase for its stage, with a strong tenancy/security foundation, but never exercised against a real provider or production environment.**

- **Architecture:** a modular NestJS monolith plus BullMQ workers, PostgreSQL with Row-Level Security, a transactional outbox, and a typed shared-contracts package. Pragmatic and appropriate; no rewrite is justified.
- **Maturity gradient:** the core (auth, tenancy, CRM, inbox, billing, automation) is clearly more mature than the newest modules (campaigns, email tracking, Google Calendar), which were added in the last three commits (~22k lines changed, mostly generated Prisma) and show visible shortcuts.
- **Biggest systemic risk:** `docs/live-verification.md` states that **no provider integration has ever been run live** (WhatsApp, OpenAI, Razorpay, SMTP/SES, KMS, Turnstile). `infrastructure/docker/docker-compose.prod.example.yml` is marked "UNVERIFIED as a whole". The product is feature-complete in simulation, not proven in reality.

### Maturity ratings (1–10, my judgement from evidence)

| Dimension | Score | Basis |
|---|:--:|---|
| Product breadth | 8 | Covers capture → qualify → nurture → book → bill |
| Product depth in newest modules | 5 | Campaigns/email/GCal have correctness and compliance gaps (§4) |
| Tenancy & data isolation | 9 | Two DB roles, RLS applied by migration loops, per-tx `app.tenant_id`, `packages/database/test/rls-isolation.test.ts` |
| AuthN/AuthZ | 8 | Global guard chain, server-side permissions, MFA, anti-escalation on roles; gaps in newest controllers |
| API design | 7 | Zod contracts + OpenAPI; inconsistent permission declaration; hand-written web client bypasses codegen |
| Reliability | 6 | Outbox + queues + sweepers are good; campaign dispatch is not idempotent; external I/O inside DB transactions |
| Test depth | 7 (quality gates currently failing: lint) | ~690 API cases incl. a security matrix; thin for newest modules' HTTP paths; no coverage gate |
| Operability / production readiness | 4 | No CD, no live verification, example-only prod compose, no dependency/secret scanning |
| Enterprise readiness | 4 | No SSO/SAML/SCIM, no data residency options, no SLA evidence |

## 4. Top risks (details in docs 08, 09, 14)

1. **Nothing proven live** — all external integrations mock-only. *Blocker for production.*
2. **Campaigns send marketing templates to any lead without an `OPTED_OUT` row**, including CSV/API/manual imports that never opted in (`campaigns.service.ts:405-436` vs `conversations/inbound.service.ts:95-96`, the only place `OPTED_IN` is written). WhatsApp-policy and DPDP exposure. *High.*
3. **Campaign dispatch is non-atomic and unguarded**: send → then persist; no claim/lock; BullMQ job id includes `Date.now()`; worker concurrency 3 (`jobs.service.ts:103,176`). A crash between send and commit re-sends the message. No quota, plan entitlement, metering or Meta rate-limit handling. *High.*
4. **Scheduled campaigns most likely never fire**: the sweep queries `broadcast_campaigns` without tenant context on the RLS-bound app role, while all other cross-tenant sweeps use `SECURITY DEFINER` functions (`campaigns.service.ts` `checkScheduledCampaigns`; migration `20261123180000`). *High, [Inference] – verify with one integration test.*
5. **Email-tracking endpoints expose tenant-wide data to `lead:read:own` users and let `lead:write:own` users add/remove tenant-wide suppressions** (`email-tracking.controller.ts`, service has no owner scoping). *Medium.*
6. **Google OAuth `state` is generated but never validated; `connect` has no schema validation** (`google-calendar.service.ts:92,123`); the UI auto-submits any `?code=` in the URL, enabling account-linking CSRF. *High* (doc 08 S-03).
7. **Bounce/complaint correlation likely fails** if mail is sent through the SES SMTP interface: `sendCustom` returns nodemailer's Message-ID and stores it as `sesMessageId` (`email-tracking.service.ts:227`), while SNS events carry SES's own id. *Medium, [Inference] — needs a live SES test.*
8. **Google Calendar live path is probably broken and hidden**: no token refresh, credentials read outside tenant context under RLS, external HTTP inside the DB transaction, all errors swallowed (`google-calendar.service.ts:157,411`; `appointments.service.ts:282,303`). Mock mode masks it. *Medium, [Inference].*
9. **Frontend contract drift risk**: only 2 files import the Orval-generated client; 65 use hand-written `lib/api` modules. *Medium.*
10. **CI is likely red on `main` and has no CD or security scanning**: `eslint .` (run by `pnpm lint` in CI) reports **164 errors** in this checkout, 122 of them `no-explicit-any` in violation of the repo's own rule, clustered in the last three commits (doc 10 §0); no dependency, secret or SAST scanning and no deploy workflow. *Medium.*
11. **Static `/design/*` mock pages ship to production** with hard-coded fake data. *Low.*

## 5. Key recommendations

1. **Run the live-verification kit** (`docs/live-verification.md`) before any customer. ~10 eng-days incl. Meta business verification lead time.
2. **Fix campaign safety** (consent model, claim-before-send, idempotency key, quotas/entitlements): ~8–10 days.
3. **Close the authorization gaps** in email-tracking and Google Calendar controllers and add a CI test that fails when a non-public controller method lacks a permission decision: ~3–4 days.
4. **Make the generated client the only API client** (or delete Orval): ~8–12 days, incremental.
5. **Add CD, dependency and secret scanning, coverage reporting**: ~5 days.

## 6. Final executive assessment

| Question | Answer |
|---|---|
| **What is this product?** | A WhatsApp-first CRM + AI lead-qualification and follow-up platform for Indian SMEs, multi-tenant SaaS, with billing and platform admin. |
| **Product maturity** | Late beta in simulation. Feature-rich; newest modules are v0.5. Not customer-proven. |
| **Architectural maturity** | Good (7/10). Right style (modular monolith), solid isolation; `ops/` is a catch-all and several services are oversized. |
| **Five biggest strengths** | (1) RLS + two-role DB design with isolation tests. (2) Server-side permission model with escalation guards and an exhaustive security-matrix test. (3) Transactional outbox + BullMQ + sweepers + worker tiers. (4) Shared Zod contracts across API/web/tests. (5) Unusually thorough docs: 12 ADRs, 11 runbooks, threat model, SLO/alert definitions. |
| **Ten biggest problems** | §4 items 1–10. Also: referential integrity relies on application code, only 36 foreign keys across 81 models (doc 07). |
| **Highest-risk technical decisions** | Mock-first integration strategy with no live proof; send-then-persist campaign loop; tenant-wide email data behind `own` permissions; hand-written web API layer next to a generated one; build-phase scaffolding (`CURRENT_PHASE`, "Soon" nav) inside product code. |
| **Production-ready?** | **No.** Not until live provider verification, campaign safety fixes, a deployed and exercised prod environment, backup-restore drill evidence and CD exist. |
| **Enterprise-ready?** | **No.** No SSO/SAML/SCIM, no IP allow-listing, no per-tenant data residency, audit export limited, no SLA evidence. |
| **Scale to 10× usage?** | Read paths: probably yes. `docs/performance.md` (2026-11-16, laptop, one tenant with 100k leads) measured dashboard p95 415 ms, lead list p95 88 ms, webhook ACK p95 91 ms, 0 errors at 20 concurrent workers. Not measured: production hardware, AI latency, anything added since (campaigns, email tracking), soak, multi-tenant scanners. Write paths for campaigns: **no** — one sequential chain per campaign with ~50 ms pacing plus network latency per recipient and two DB transactions each. [Inference] |
| **Fix immediately** | Scheduled-campaign sweep; campaign consent + idempotency; email-tracking authorization; GCal OAuth state; live verification. |
| **Next three initiatives** | (1) Production hardening & live verification. (2) Campaign v1.1: consent ledger, quotas, throttled idempotent sender, template/opt-in workflows, delivery analytics. (3) Contract unification + modular boundaries (`ops/` split, client codegen) to keep velocity as the team grows. |
