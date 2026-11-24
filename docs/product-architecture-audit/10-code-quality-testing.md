# 10 — Code Quality & Testing

> **Status 2026-11-24:** lint is now 0 errors (PR #3) and the failing tests listed in `01-executive-summary.md` (Remediation status) were reduced; the numbers below describe `dce256d` as audited.

## 0. What I actually ran (read-only, 2026-11-23, `main` @ `dce256d`)

| Command | Result |
|---|---|
| `tsc --noEmit` in `apps/api` and `apps/web` | **Clean** (no diagnostics) |
| `eslint .` (what root `pnpm lint` and CI run) | **FAILS: 174 problems (164 errors, 10 warnings).** 122 × `@typescript-eslint/no-explicit-any`, 31 × `no-unused-vars`, 6 × `react-hooks/set-state-in-effect`, 6 × `react-hooks/incompatible-library`, 4 × `exhaustive-deps`, 2 × `consistent-type-imports`, 1 × `purity`, 1 × `no-useless-assignment` |
| `vitest run` in `apps/web` | 16 files, **86 tests pass** |
| `vitest run` on 5 API unit suites (`campaigns-unit`, `roles-custom-unit`, `worker-tiers-unit`, `google-calendar-unit`, `ses-sns-validator`) | **33 tests pass** |
| DB-backed API suites, Playwright E2E | **Not run** (need Postgres/Redis/browser) |

**Consequence:** CI (`.github/workflows/ci.yml`) runs `pnpm lint` before `pnpm test`, so the `verify` job should be red on `main` [Inference: I cannot see run history]. The failing files cluster in the last three commits: `packages/database/src/soft-delete.ts` (31), `apps/api/test/email-tracking.test.ts` (21), `roles-custom-unit.test.ts` (19), `campaigns-unit.test.ts` (18), `worker-tiers-unit.test.ts` (12), `create-campaign-dialog.tsx` (8), `emails/page.tsx` (5). The repo's own rule says "Product requirement: no `any`" (`eslint.config.mjs`). Quality gates exist but are not being honoured: a signal that work is merged without CI.

Also: each package's `lint` script is `tsc --noEmit` (`apps/api/package.json:12`, `apps/web/package.json:11`), so `turbo run lint` is only a type check; the real lint is the root `eslint .`.

## 1. Maintainability assessment

| Dimension | Rating | Evidence |
|---|:--:|---|
| Type safety | Good | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` (`tsconfig.base.json`); Zod-inferred types shared across packages; the `any` debt is concentrated in `soft-delete.ts` (Prisma extension typing), new tests and the campaign dialog |
| Separation of concerns | Mixed | Services own business logic and tenancy; but controllers live inside `*.module.ts`, `ops/` is a catch-all, and page components in the web app mix fetching, state and layout |
| SOLID/SRP | Weak spots | `email-tracking.service.ts` (976 lines: token signing, HTML rewriting, sending, suppression, SNS event handling, stats), `campaigns.service.ts` (814: segment builder, launch, dispatch, scheduling, recipients), `leads.service.ts` (486), `appointments.service.ts` (453), `automation-engine.ts` (419) |
| Dependency inversion | Mixed | Nest DI used well; exceptions: mutable callbacks on `JobsService` (`processCampaignBatch`, `checkScheduledCampaigns`, `processDoc`) assigned by feature services; `@Optional()` cross-module injection (`AppointmentsService` → `GoogleCalendarService`) |
| DRY | Fair | Actor/permission scoping helpers are re-implemented per service (`leads.service.ts:24-33`, `tasks.service.ts:11-12`, `appointments.service.ts:75-77`, `conversations.service.ts:35-36,156`); `getStatus`/`connect` tenant-tx boilerplate repeated; hand-written web API clients duplicate generated ones |
| Naming/consistency | Good | Consistent domain vocabulary; mixed `ctx`/`actor`/`a` parameter names for the same concept; UUIDv7 vs `gen_random_uuid()` mixed |
| Error handling | Good at edges, uneven inside | Structured `HttpException` codes; but `.catch(() => null)` swallowing (`appointments.service.ts:282,303`), empty `catch {}` in the open-pixel route (intentional), campaign errors stored as `{message}` JSON without classification |
| Dead / scaffolding code | Present | `CURRENT_PHASE`/`phase`/"Soon" in `nav.ts`; unused `GoogleCalendarSync.syncToken/channelId`; `/design/*` pages; `sesMessageId` duplicate of `smtpMessageId` |
| Comments / docs | Excellent | ADRs 0001–0012, runbooks, threat model, SLOs; comments explain intent. One misleading comment: "rate-limit guard" on `dispatchBatch` (no limiter exists) |
| Component complexity (web) | High in places | `tasks/page.tsx` 799, `leads/page.tsx` 723, `appointments/page.tsx` 575, `emails/page.tsx` 513, `webhooks/page.tsx` 511 lines; 50 of 51 pages are client components |
| Newest code vs. older code | Quality drops | Core modules carry `ZodPipe`, permission decorators, audit events, tests; Google Calendar controller lacks validation/permissions, campaigns/email modules lack HTTP-level tests and fail lint |

### Specific hot spots

| File / function | Issue |
|---|---|
| `campaigns/campaigns.service.ts` `dispatchBatch` (L562-700) | send-then-persist, no claim, per-recipient transactions, 140-line function with nested try/catch |
| `campaigns/campaigns.service.ts` `launch` (L383-507) | loads entire audience in memory; no CAS on status; one long transaction |
| `campaigns/campaigns.service.ts` `checkScheduledCampaigns` (end) | bypasses RLS context (doc 07 §4.7) |
| `email-tracking/email-tracking.service.ts` `instrumentHtml` (L99-122) | regex HTML rewriting; only wraps `https?://` anchors with double/single quotes; `<a>` tags spanning attributes unusual, `<area>`, CSS URLs, and unsubscribe links are not considered |
| `email-tracking/email-tracking.service.ts` L57 | secret fallback chain with a literal |
| `integrations/google-calendar/google-calendar.service.ts` `getAuthUrl`/`connect` | unsigned state, never verified; raw `fetch` without timeout/`AbortSignal` (not confirmed for all calls) |
| `ops/jobs.service.ts` L47-53, L97-103, L222 | callback wiring; silent skip when unset |
| `packages/database/src/soft-delete.ts` | 31 lint errors; implicit `any` pass-through defeats typing of every soft-deleted model query |
| `common/guards.ts` `TenantGuard` | one DB transaction per request, no cache |
| `apps/web/lib/*.ts` vs `lib/api-generated` | dual client strategy |
| `apps/web/app/(app)/tasks/page.tsx` | 799-line page |

## 2. Technical-debt register
See `14-technical-debt-register.md` (30 items with evidence and priority).

## 3. Testing assessment

### 3.1 Inventory
| Layer | Tooling | Count | Notes |
|---|---|---|---|
| API unit/integration | vitest 5.1 + supertest, real Postgres/Redis via `helpers.ts` (`createTestApp`) | ~65 files, ~689 cases | Most are integration tests through the real Nest app; `*-unit.test.ts` for newest modules use mocks |
| Security matrix | `security-matrix.test.ts` | 209 lines | route discovery, 401 sweep, public allow-list, permission-declaration review list, role matrix, error/secret leak, CORS/headers, agent behaviour, SSRF |
| Web unit | vitest | 16 files / 86 cases (all pass) | utilities and a few dialogs; **no page-level component tests** |
| E2E | Playwright 1.65 + axe, Chrome channel | 19 specs / ~60 cases | auth, leads, widget+inbox, billing, AI+appointments, platform, security, keyboard, MFA, a11y, mobile, automation builder/canvas, packs, retention, error pages, ops status, embedded signup, alert settings |
| DB | vitest | 3 files in `packages` | `rls-isolation.test.ts` etc. |
| AI evaluation | `apps/api/test/eval` + `eval.test.ts` | cases file | live eval gated by `EVAL_LIVE=1`; never run live |
| Load | `scripts/loadtest.mjs` | manual | results in `docs/performance.md` |
| CI | GitHub Actions | `verify` + `e2e` jobs | no coverage, no flake tracking, E2E only on Chrome |

### 3.2 Strengths
- Tests assert behaviour at tenant and permission boundaries, not only happy paths.
- Test environment uses the real app + DB, which catches RLS/guard regressions.
- E2E includes accessibility, keyboard and mobile.
- `env-example.test.ts` checks that `.env.example` plus the required secrets loads as a valid configuration (it does not catch undocumented variables); `alert-runbooks.test.ts` couples alerts to runbooks.

### 3.3 Gaps by critical workflow
| Workflow | Coverage today | Gap |
|---|---|---|
| Campaign launch → dispatch → delivery receipts | `campaigns-unit.test.ts` (mocked DB/WhatsApp) | No test against RLS-bound DB; no scheduled sweep test; no concurrency/double-dispatch test; no consent-eligibility test; no HTTP/permission test; no E2E |
| Email send → track → SNS bounce → suppression | `email-tracking.test.ts` (412 lines), SNS validator | No cross-user scoping test (S-05), no SES-id correlation test with a realistic SES payload |
| Google Calendar | `google-calendar*.test.ts` | OAuth state/CSRF not tested; failure-path of `syncAppointment` not tested |
| Custom roles | `roles-custom-unit.test.ts` | No HTTP integration test of escalation guards on `PATCH /roles/:id`, member role change with custom roles, or deletion with members assigned |
| Worker tiers | `worker-tiers-unit.test.ts` | No test that each tier registers the expected queues/workers against Redis |
| RLS on new tables | `rls-isolation.test.ts` | Catalog-level test exists (every `tenant_id` table has RLS + a policy; per-table isolation checks), so new tables are covered automatically. Gap: nothing tests cross-tenant system sweeps on the app role (S-04) |
| Billing against Razorpay | mock only | Live smoke scripts never run |
| WhatsApp inbound/outbound | mock client | Live smoke never run |
| Frontend pages | E2E for older pages | No E2E for campaigns, emails, roles builder, GCal card |
| Data erase/export | `data-lifecycle.test.ts` | Not confirmed to include new PII tables |
| Concurrency | `appointments-exclusion-unit` and automation CAS | No test for simultaneous campaign launch or duplicate webhook bursts on new endpoints |

### 3.4 Recommended pyramid and strategy
```
        E2E (Playwright)           ~10%   critical journeys per module + a11y: add campaigns, emails, roles, GCal
      API integration (real DB)    ~35%   every module's permission matrix + RLS + concurrency
   Contract tests (OpenAPI/Zod)    ~10%   generated-client vs spec; webhook payload fixtures from real providers
 Unit / pure logic                 ~45%   money, phone, scoring, segmentation, scheduling, availability
 Static gates: tsc + eslint + audit + secret scan   every PR
```
Priority order:
1. **Make CI green and keep it green**: fix the 164 lint errors (mostly typing `soft-delete.ts` and tests) or consciously relax the rule per directory; add branch protection requiring `verify`. (≈ 3 days)
2. Add a **system-sweep test on the app role**: every worker sweep (`checkScheduledCampaigns`, scanners, outbox) returns rows through its `SECURITY DEFINER` function when no tenant context is set. (≈ 1 day)
3. Add **integration tests for campaigns** on the real DB: scheduled sweep, consent eligibility, double-dispatch, cancel mid-flight, 429 handling. (≈ 3 days)
4. Add **authorization tests for email-tracking and Google Calendar**, and OAuth state tests. (≈ 1.5 days)
5. **Provider contract fixtures**: record sanitized real payloads from the live-verification run and replay in tests (WhatsApp statuses, Razorpay events, SNS bounce). (≈ 3 days after live verification)
6. Add **coverage reporting** (v8) with a ratchet; target 80% lines on `common/`, `leads/`, `conversations/`, `campaigns/`, `billing/`. (≈ 1 day)
7. Add Firefox/WebKit smoke to Playwright and a nightly full E2E; quarantine flaky tests with tracking. (≈ 2 days)
8. Mutation-test the permission layer (`PermissionsGuard`, scoping helpers) with Stryker on a nightly job. (optional, ≈ 2 days)
