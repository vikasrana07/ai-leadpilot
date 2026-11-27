# LeadPilot AI — Progress

Legend: ☐ pending · ◐ in progress · ☑ done (verified) · Tags: **M** = MVP, **V** = V1.1, **L** = Later
Last updated: 2026-11-27 · Current phase: **Phase 8 + 5 USP MVPs built; lint/typecheck/web tests verified locally; API integration tests require local Postgres (`localhost:5433`); real external providers and AWS deployment still unverified**

## Phase status
| Phase | Status |
|---|---|
| 0 Plan | ☑ approved |
| 1 Foundation | ☑ |
| 2 CRM | ☑ |
| 3 Communication | ☑ (live Meta client still unverified) |
| 4 AI | ◐ built; verified with an offline mock model only (see below) |
| 5 Automation & appointments | ☑ built; verified with mock WhatsApp/LLM (see below) |
| 6 SaaS | ◐ plans, billing (mock-verified), GST invoices, gating, platform console built; Razorpay never called for real; 5 V1.1 items deferred (see below) |
| 8 Launch blockers, V1.1, polish | ◐ built and tested locally (see Phase 8 verification); real KMS/Turnstile/Razorpay/Meta/OpenAI/SMTP unverified; Embedded Signup (mock-verified) and Google Calendar sync built afterwards |
| 9 Visual automation builder | ◐ milestones 1-4 built and tested locally: graph model + versions + waits + API (c46972f), Outline editor, canvas (@xyflow/react 12.12.1), graph templates, user guide; real WhatsApp after a wait, worker restart while waiting, load with many waiting runs unverified |
| 9b Industry packs v2 | ◐ coaching, healthcare, home services packs; pack-driven lead form, wording, scoring, AI guidance (7bd66f1); content needs review by people in each trade; clinic WhatsApp use needs legal review |
| 10 USP MVPs (1–5) | ☑ **Slot Rescue**, **15-Second Voice-to-CRM**, **Shadow-to-Live AI Auto-Pilot**, **WhatsApp Promise-Tracker**, and **Revenue Leakage Radar** built and lint/typecheck/web-tested; API integration specs ready to run against local Postgres |
| 7 Hardening & launch | ◐ E2E, security review, load test, restore drill, runbooks, Dockerfiles done; KMS key provider, bot protection, MFA, retention job, external security review, lawyer review of legal drafts, AWS deployment still open |

## Phase 0 deliverables
- ☑ Repository inspected (only `MASTER_PROMPT.md` present; no git repo, no code)
- ◐ `docs/architecture.md` (draft)
- ◐ `docs/decisions/0001-initial-decisions.md` (ADR-0001…0010, proposed)
- ◐ `docs/database-schema.md` (outline)
- ◐ `docs/unit-economics.md` (model only; prices unverified)
- ☑ Version list checked against npm registry (see architecture §11); **not yet installed or built**
- ☐ User approval

## Feature checklist (all pending until their phase)

### Tenancy, auth, RBAC (Phase 1)
- ☑ M Tenant model + settings (API + settings UI)
- ☑ M Onboarding wizard, resumable. Steps 1-7 functional (business, industry, team, WhatsApp Embedded Signup + manual, AI assistant, knowledge upload, qualification rules; steps 3-7 skippable)
- ☑ M Register / login / logout / verify email / forgot+reset password
- ☑ M Refresh rotation with reuse detection; session list/revoke
- ☑ M Invitation-based signup
- ☑ M Roles + granular permissions (39 keys), guards; custom roles (create/edit/delete) built in API & UI
- ☑ M Audit log (append-only at DB grant level) + viewer
- ☑ M RLS on all tenant tables + isolation test suite
- ☑ M Design tokens, light/dark/system theme, no-flash inline script (visually confirmed dark persistence; flash itself not measured)
- ☑ M App shell: sidebar (collapse), header (workspace switcher, quick-create menu, command palette with navigation + quick actions + live lead search, theme, profile), breadcrumbs component
- ☑ M i18n infrastructure: `I18nProvider` + `en.json` / `hi.json` message catalogues, header language switcher, currencies/timezones + ₹ lakh/crore formatting (remaining screens migrating incrementally)
- ☑ V Permission overrides per member · ☑ L Fully custom roles
- ☑ Responsive: verified in an emulated 390px viewport (phase 2): drawer nav, stacked filters, lead cards instead of a table, single-column dashboard. Kanban scrolls horizontally on phones by design
- ☑ Design-review screens (sample data, labelled, gated in production): /design/dashboard, /design/inbox, /design/lead, /design/pipeline
- ☑ Design pass 2 (2026-11-16, from user reference images): navy sidebar + tinted header tokens, KpiCard (count-up, delta, sparkline), inbox queue rail with counts and a "Join conversation" takeover. Pass 3 (user chose): deeper near-black navy #0e1433, denser cards (26px KPI numbers, tighter padding, 13px base type). Awaiting user feedback

### CRM (Phase 2)
- ☑ M Lead CRUD, soft delete, search (trigram-indexed), filters, sort. **Deviation:** page/offset pagination with totals instead of cursor (simpler UI, fine at the budgeted scale; revisit if lists exceed ~100k)
- ☑ M CSV import (two-step: dry-run report then confirm; Indian amounts like "85 L", "1.2 Cr") / export (formula-injection safe)
- ☑ M Bulk assign / stage / tag / delete with per-lead failure report
- ☑ M Duplicate detection (any phone format, email), override, lead merge + audit (history of merged leads stays on the survivor)
- ☑ M Activity timeline, notes, tags, custom fields, attachments
- ☑ M Lead detail page (loading / error / empty / success states)
- ☑ M Lead capture API (API key, hashed at rest, shown once, revocable) + Integrations page. Repeat enquiries append to the existing lead. Server-to-server only; browser capture arrives with the widget public key (phase 3)
- ☑ M Pipeline Kanban (drag-drop + keyboard-accessible move menu, optimistic update with rollback), stage config, transition history, lost reasons, server-enforced transition rules
- ☑ M Property inventory (CRUD, filters, CSV import); `PropertiesService.where()` is the structured-data source for the AI `search_properties` tool in phase 4
- ☑ M Industry Pack loader (real estate + general pack), idempotent, never overwrites tenant edits; backfill + system-role sync run on migrate
- ☑ M Dashboard from real data: KPIs with deltas, acquisition trend, pipeline, sources, hot leads, follow-ups, agent table, date ranges incl. custom, tenant-timezone aware. Appointment/AI/automation tiles intentionally absent until those modules exist (API returns null, never invented)
- ☑ M Team workload + round-robin assignment (safe under concurrent creates)
- ◐ M i18n: message-catalogue scaffold + ₹ lakh/crore formatting only. Most strings are still inline English
- ☑ V Portal email parsing · ☑ L Meta Lead Ads · ☑ L Google Sheets
- ☑ Lead scoring built in phase 4 (manual score/temperature override also supported)

### Communication (Phase 3)
- ☑ M Conversations/messages, 3-panel inbox (single-pane on mobile), unread counts, queues, filters, search, assign, close/reopen, takeover, internal notes, tags, delivery ticks, media rendering, failed-send retry
- ☑ M Real-time via SSE over Redis pub/sub, scoped per agent; live unread badge in the sidebar
- ◐ M WhatsApp Cloud API (manual token): connect/test/rotate/disable, webhook handshake + HMAC verification, inbound text/media/unsupported types, status receipts (monotonic), outbound text and templates, encrypted credentials. **The live Meta client is written but has never been run against Meta**; everything is verified with the mock provider
- ☑ M 24-hour window, opt-out (STOP) and consent enforced server-side; template registry (names of already-approved templates)
- ☑ M Webhook security: unguessable URL key, per-channel app-secret HMAC over raw body, payload/number match, dedupe by body hash and by message id
- ☑ M Website widget: public key + allowed origins, Shadow-DOM loader, lead capture, session tokens, polling, key rotation revokes sessions, admin UI with install snippet
- ◐ M Retries/rate limits: bounded inline retry + manual retry now; scheduled background retries in phase 5 (ADR-0016)
- ☑ Refresh-token race fixed (ADR-0015)
- ◐ V Embedded Signup (mock-verified) · ◐ V Template manager/sync with Meta (read-only sync, mock-verified) · ☑ V Canned replies · ☑ L Broadcasts · ◐ L Email tracking (SES) · ☑ L Messenger/Instagram (mock-verified)
- ☐ Media is proxied, not stored (ADR-0017); attachments to leads and durable storage are phase 4

### AI (Phase 4)
- ☑ M Provider abstraction (`LlmProvider`/`EmbeddingProvider`), prompt versioning (`v1.0` on every run), per-run logging (tokens, latency, tools, guard decisions)
- ◐ M Orchestrator: debounce, one turn at a time, answered-through tracking, tool loop (≤5), guards with one retry, safe fallback handover. **Verified with the offline mock only**; the live OpenAI client is written but **has never run** (no key)
- ☑ M Ten tools: eight live (`get_business_info`, `search_properties`, `get_lead_details`, `update_lead`, `calculate_lead_score`, `assign_agent`, `create_followup`, `handover_to_human`); `check_availability` and `create_appointment` are live since phase 5. All validated, tenant-bound, idempotent, audited
- ☑ M Knowledge base: upload (PDF/DOCX/TXT/CSV, 10 MB, magic-byte check), **real ClamAV** scan (fail closed), **real S3 storage** (MinIO), isolated parsing, chunking, embeddings in **pgvector** (HNSW), status, preview, reprocess, delete, search, tenant-isolated retrieval. Mock embeddings offline; real embedding quality unverified
- ☑ M Lead scoring: configurable, versioned, explainable; unknown ≠ negative; manager override with reason, history, audit; re-score on rule change
- ☑ M Handover: keyword (no model call), model tool, guard failure, model outage, token cap; takeover/hand-back; working-hours-aware message; AI disclosure; welcome message
- ☑ M Usage metering with monthly token cap (hard stop), 80% warning, platform kill switch, usage meter and activity log in the UI
- ◐ M Eval harness: **39 golden conversations** (EN/Hindi/Hinglish; extraction, search, knowledge, handover, safety, language, conversation). 26 run offline and pass; **13 need a real model and have never run**. Offline results validate the pipeline, not language-model quality
- ☑ M Injection corpus and cross-tenant context test (see threat model)
- ◐ M English + Hindi/Hinglish: configured and in the prompt; **replies in Hindi/Hinglish are untested** (needs a real model)
- ☑ M Attachments on leads (DB table + RLS + composite FK, S3/MinIO storage + fail-closed virus scan, merge re-parenting, lead detail card)
- ☑ V Additional Indian languages (Marathi, Tamil, Telugu, Kannada, Gujarati, Bengali added to AI_LANGUAGES + system prompt + UI)

### Automation, appointments, notifications (Phase 5)
- ☑ M Appointments: CRUD, status machine, reschedule (linked history), availability + days off, week calendar + upcoming list, **no double booking enforced by Postgres exclusion constraints** (ADR-0026), DST-safe (ADR-0027)
- ☑ M Reminders/confirmations: confirmation on booking, 24h/2h customer reminders and a 1h agent reminder, each exactly once (ADR-0030). Customer messages are WhatsApp **templates** the tenant must register; until real Meta is connected they only run against the mock provider
- ☑ M Outbox relay + BullMQ workers (retries with backoff, failed jobs retained as the dead-letter set, orphan sweeper, minute scheduler), `apps/worker` entry (ADR-0028)
- ☑ M 8 automation templates, run history with step detail, retries (automatic + manual), dry-run, loop protection, cooldown (ADR-0029). **Custom automations: API only**; the UI offers templates, on/off, test, history, delete (no visual builder, [L])
- ☑ M In-app notifications (bell, live over SSE) + per-type preferences; tasks (manual + from automations) with due reminders
- ☑ M SLA tracking + alerts (ADR-0032), settings card
- ☑ M Basic usage tracking (`GET /usage`, Usage page): metering only, no enforcement or billing (phase 6)
- ☑ M AI scheduling tools enabled with a time-grounding output guard (ADR-0031)
- ☑ M Redis-backed rate-limit store (counters shared across API instances; falls back to per-instance memory if Redis is down)
- ☑ V Email / WhatsApp-to-staff / web push notifications (VAPID Web Push + sw.js) · ☑ V Google Calendar · ☑ L Visual workflow editor (Phase 9)

### SaaS (Phase 6)
- ☑ V Plans/entitlements (DB-driven, editable by platform admins), Razorpay subscriptions (mock-verified; **live client never run**), GST invoices (accountant review pending), dunning/grace, trial, plan gating in the backend
- ☑ V Quotas + 80%/100% alerts (owners notified once), plan-limit bars on the Usage page · ☑ V 14-day usage history trend (`GET /usage/history` + chart)
- ☑ V Platform console (tenants, MRR, usage, plans, suspend/reactivate, complimentary/trial plans, audit) · ☑ V read-only support access (opt-out per workspace; default on: decision pending) · ☑ V platform health page (`/platform/health`)
- ☑ V Public API (`/v1`, scoped keys, `api_access` plan feature) + outbound webhooks (signed, SSRF-safe, retried)
- ☑ V Reports (7) & CSV export (plan-gated)
- ☑ V Compliance workflows: lead export/erasure, retention purge, workspace export, workspace deletion (legal review of retained invoices needed)
- ◐ V WhatsApp Embedded Signup (mock-verified) · ☑ V Google Calendar sync

### Quality & launch (Phase 7)
- ☑ Full E2E suite (12 Playwright tests, desktop Chrome, local; CI job written but never run on GitHub) · ☑ Security review pass (self-review; `docs/security-review.md`) · ☑ Load test vs budgets (`docs/performance.md`; AI reply latency unmeasured) · ☑ Backup/restore drill (logical dump; RDS PITR not drilled)
- ☑ Runbooks (9) · ☑ Deployment guide + Dockerfiles (images built and booted locally; AWS unverified) · ◐ SLOs/alerts (documented; only log/table-based SLIs measurable) · ◐ Legal templates (drafts written; **need a lawyer's review**) · ☑ DPDP single-lead export/erasure (API) · ☑ tenant-wide export/deletion, retention job, KMS key provider, bot protection, MFA (built in Phase 8; live KMS/Turnstile unverified)

## Consent ledger hardening (2026-11-27, branch `feat/consent-ledger`)
- `consents` now records **purpose** (transactional / service / marketing), **method**, actor, wording version and evidence; `consent_suppressions` keeps a salted phone hash so an opt-out survives lead erasure (`erase_lead()` redefined). One module (`apps/api/src/campaigns/consent.ts`) decides eligibility and is the only writer; the four inline queries and the campaign gates now use it.
- **Behaviour changes:** a plain inbound WhatsApp message is only SERVICE consent (replies), no longer a marketing opt-in; an ordinary message no longer undoes a STOP (only START or a manager-visible explicit opt-in); Meta Lead Ads give SERVICE consent; marketing-category templates need a MARKETING opt-in; CSV `whatsapp_consent` and API/form `consent` are recorded only with attestation / explicit input.
- New: `GET/POST /leads/:id/consents`, lead-page Consent card, CSV attestation, `consent_changed` timeline entries and `consent.opted_in/out` audit rows. `apps/api/test/consent-ledger.test.ts` (13 tests).
- **Not done yet (follow-ups):** automatic STOP confirmation message, widget consent checkbox, email `List-Unsubscribe`, consent expiry UI, legal review of the wording.

## Baseline verification (2026-11-27)
- Local infra up (Postgres/Redis/MinIO/ClamAV via `pnpm infra:up`). `pnpm typecheck` ✔ · `pnpm lint` ✔ (0 errors, 14 warnings) · `pnpm test` ✔ (**API 921, web 127, database 28, validation 11**), including all five USP specs.
- **Bugs found by running the previously unrun USP specs and fixed:** (1) portal-email webhook always 404: `portal_email_configs` had FORCE RLS, so the SECURITY DEFINER lookup saw no rows (migration `20261127130000_portal_email_no_force_rls`); (2) Slot Rescue claims always 403: the system actor lacked `lead:write:all`; (3) customer **Confirm** on a staff-booked (already CONFIRMED) appointment returned 409, now an idempotent no-op; stale test assertions in `slot-rescue` and `portal-m2` updated.
- **Still not verified:** all real providers (Meta, OpenAI, Razorpay, SES/KMS/Turnstile), CI on GitHub, Playwright E2E for the new screens. See `docs/live-verification.md`.

## Phase 1 verification (2026-11-16)
- `pnpm lint` ✔ (ESLint incl. no-explicit-any, plus tsc) · `pnpm typecheck` ✔ · `pnpm test` ✔ (13 DB/RLS + 30 API tests) · built API boots under plain Node (`smoke`) ✔
- Real browser run (Chrome): register → onboarding step saved → dark theme persisted across navigation → team + audit pages show real data ✔
- **Not verified:** CI workflow (never run on GitHub), mobile viewport, Playwright E2E (phase 7), real email delivery (Mailpit only)

## Phase 2 verification (2026-11-16)
- `pnpm lint` ✔ · `pnpm typecheck` ✔ · `pnpm test` ✔ (**19 DB/RLS + 78 API tests**) · built API boots under plain Node ✔
- New tests cover: CRM tables in the RLS guard + append-only history, agent row-scoping (404 not 403 for others' leads), cross-tenant read/update/merge/stage/assign attempts, stage rules, bulk, merge, CSV import/export (incl. formula injection), round-robin under concurrency, API-key capture (revoked/forged/session-token-as-key), property inventory, analytics **checked against a hand-computed fixture**, timezone and DST date ranges, system-role sync
- Real browser (Chrome): login → dashboard on real data → leads list → lead detail → rejected "New → Won" move shows the server's message → valid move + note appear on the timeline → Kanban renders
- **Bug found and fixed while verifying:** permissions added in code never reached existing tenants. `pnpm db:migrate` now syncs system roles (additive/removing, idempotent, tested)
- **Not verified:** Playwright E2E (phase 7); drag-and-drop with a real mouse (menu path verified, HTML5 DnD not exercised); CSV import through the file picker in the browser (API-level tested); CI workflow on GitHub; real email

## Phase 3 verification (2026-11-16)
- `pnpm lint` ✔ · `pnpm typecheck` ✔ · `pnpm test` ✔ (**19 DB + 113 API tests**) · built API boots under plain Node ✔
- New tests: envelope encryption (round-trip, tamper, wrong tenant), connect validation, secrets never returned/logged, webhook handshake, **forged/missing/wrong-secret/altered-body/other-tenant signatures**, exact and re-wrapped replays, wrong-number payloads, media safety headers, 24h window, templates, opt-out, idempotent sends, transient/permanent provider failures + retry, agent scoping and cross-tenant 404s, widget CORS/origin/session/key-rotation rules, SSE delivery and its scoping
- Real browser (Chrome): signed webhooks delivered to the real server → inbox shows them with unread badges → opened a thread (marked read) → sent a reply → new inbound messages appeared **live** without refresh → Integrations page with setup guide → website widget loaded from `/widget.js`, visitor chatted, team reply appeared in the widget → mobile emulation (single-pane inbox)
- **Not verified:** anything against real Meta (live client, payload quirks, media download, template sends, rate-limit codes); real email; widget on a genuinely different origin (verified on localhost:3100 as the allowed origin; non-allowed origins are covered by API tests); Playwright E2E (phase 7); CI on GitHub

## Phase 4 verification (2026-11-16)
- `pnpm lint` ✔ · `pnpm typecheck` ✔ · `pnpm test` ✔ (**19 DB + 206 API tests**; includes real MinIO, pgvector, ClamAV) · smoke ✔
- Browser (Chrome): configured and enabled the assistant → uploaded a document through the UI (scan, store, index → Ready) → semantic search → a WhatsApp customer chatted: lead qualified automatically (budget, area, type, timeline), answered the loan question from the document, handed over on request → activity log with tools/tokens/latency → lead score ring with per-signal explanation and history
- **Bugs found by this phase's testing and fixed:** (1) PDF parsing broke JWT verification process-wide, so parsing now runs in an isolated worker; (2) WhatsApp's 1-second timestamps mis-ordered replies; (3) a customer message sent while the assistant was composing was never answered; (4) a database error after a successful send marked the message failed and showed internal error text to users; (5) documents could smuggle instructions to customers; (6) amount extraction double-counted "₹1.2 Cr"
- **Not verified, important:** any real LLM (OpenAI client, strict-schema tool calling, real extraction accuracy, Hindi/Hinglish, tone, real injection resistance, token costs); real embedding quality; the 13 live-only eval cases; Playwright E2E; CI on GitHub (workflow now also starts MinIO and ClamAV)

## Phase 5 verification (2026-11-16)
- `pnpm lint` ✔ · `pnpm typecheck` ✔ · `pnpm build` ✔ · `pnpm test` ✔ (**19 DB + 256 API tests**): includes a 12-way concurrent double-booking race (exactly one wins), DST/timezone arithmetic (New York spring/fall, Kolkata), loop-protection bounds, idempotent re-execution, retry-then-fail-then-manual-retry, scanner exactly-once, SLA breach/resolve, notification scoping and preferences, tenant isolation, concurrent outbox claiming with lease expiry, and **real BullMQ workers over real Redis** (end-to-end run, 3 attempts with backoff then FAILED, scheduler registered once)
- Real browser (Chrome): week calendar with real bookings, booking dialog with live slot search, notification bell filled by the real worker, automations page (templates installed, enabled, missing-template warning), usage page. Redis rate limiting verified live (10 allowed then 429, counters in Redis)
- **Bugs found by this phase's testing and fixed:** an automation run with a non-UUID event id threw forever and stalled the whole outbox drain (now tolerated); people were notified about their own bookings; the loop-protection bound I first asserted was too tight (two mutually triggering automations produce at most 14 run rows, by design)
- **Not verified:** real WhatsApp template delivery (and that tenants' templates are approved by Meta); real LLM scheduling behaviour (the mock follows a scripted flow; a real model may phrase offers differently, and the time guard may reject valid replies: watch `unsupported_time` in AI runs once a key is available); mobile layout of the new pages; multi-worker behaviour beyond the concurrency tests; Playwright E2E; CI on GitHub; the web UI has no tests of its own; clicked through in the browser: calendar, booking dialog, bell, automations, dry-run dialog, tasks, usage, SLA card. Not exercised in the browser: reschedule/cancel dialogs, working-hours editor, notification preferences dialog, run-history retry button
- **Known limits:** reminders and automations are only as reliable as the worker process running; with `WORKERS_ENABLED` off nothing is processed (documented). Delivery failures from the provider are recorded on the message and the step is not auto-resent (a retry could duplicate a customer message); resend is manual from the inbox. No calendar sync (V1.1).

## Decisions needed from the user
1. ☑ Phase 0 plan approved.
2. ☑ `git init` done; **no remote, work stays local** (decided 2026-11-16).
3. ☑ TypeScript 6.0.3 and Prisma 7.10.1 (ADR-0008) agreed.
4. ☑ **WhatsApp billing: tenants pay Meta directly on their own WABA** (decided 2026-11-16). LeadPilot plans price the software only; no WhatsApp resale or margin.
5. **OpenAI API key** (and default model). Needed to verify the live AI client and run the 13 live-only eval cases. Until then the assistant runs on the offline mock. I will not use a key until you provide one.
6. **Meta test assets:** still needed to verify the live WhatsApp client. Do you have a Meta developer account / WhatsApp test number? (Phase 3 was verified with the mock provider.)
7. **Email provider** for transactional mail (SES, Resend, other). Mailpit is used locally.
8. ☑ Lead = person record in MVP (ADR-0010) agreed.

## Assumptions made (unless you object)
- pnpm + Turborepo; SSE for real-time; AWS ECS/Fargate as the reference deployment.
- Manual WhatsApp token entry for MVP, Embedded Signup in V1.1.
- Brief prices are ex-GST.
- English + Hindi/Hinglish for the AI in MVP.

## Phase 6 verification (2026-11-16)
- `pnpm lint` ✔ · `pnpm typecheck` ✔ · `pnpm build` ✔ · `pnpm test` ✔ (**19 DB + 303 API tests**, incl. `billing` 28, `platform` 15, `billing-enforcement` 4)
- Covered by tests: webhook signature (forged/tampered/missing), event de-dup and payment-level idempotency, out-of-order and stale events, GST split (CGST+SGST vs IGST), gap-free invoice numbers under concurrency, invoice immutability and tenant isolation, trial/grace/read-only/cancel lifecycle, feature/seat/automation/AI-cap/WhatsApp-cap gating, AI and automations on lapsed or ineligible plans, upgrade/downgrade including over-quota refusal, platform auth (separate audience, lockout, CSRF, instant revoke), reasoned+audited tenant actions, plan editing reaching live customers, platform audit RLS
- Real browser (Chrome, mock provider, SIGNUP_PLAN=growth, real worker): signup starts a 14-day trial → Billing page (plans, GST-inclusive prices) → billing-details dialog → subscribe → simulated signed webhooks activate the plan and issue invoice `LP/2026-27/…` → printable GST invoice (CGST+SGST) → notifications → platform console login, MRR (₹9,999 = the one paying subscription), plans page
- **Bug found while verifying and fixed:** the plans page showed "0 workspaces" for every plan (the `tenants` table is under RLS and invisible to console code; counts now come from the SECURITY DEFINER metrics function; test added)
- **Not verified:** real Razorpay (every request/response shape, checkout modal, real webhook payloads, proration), real dunning email delivery, invoice SAC/format with an accountant, platform tenant-detail/suspend/assign-plan and plan-edit screens in the browser, the red/amber/blue billing banners and the invoice page print layout, mobile layout

## Phase 7 verification (2026-11-16)
- `pnpm lint` ✔ · `pnpm typecheck` ✔ · `pnpm build` ✔ · `pnpm test` ✔ (**19 DB + 324 API tests**) · `scripts/e2e.sh` ✔ (**12 Playwright tests**, production builds on ports 3200/4100, ~45 s)
- New tests: route inventory + authz matrix (14), webhook crash recovery, env-example validity, realtime across two API instances, lead export/erasure (3), plus the E2E journeys (auth, lead + stage move by mouse and keyboard, widget → inbox in real time, trial → subscribe → GST invoice, AI books a visit, platform console suspend/reactivate, CSP/redirect safety, keyboard smoke)
- Load test at 100k leads: dashboard p95 415 ms (budget 2 s), webhook ACK p95 91 ms (budget 1 s), 0 errors under 20 concurrent workers (`docs/performance.md`)
- Restore drill (logical dump, 192 MB): passed with row counts, RLS, grants, constraints and tenant isolation verified (`docs/runbooks/database-backup-restore.md`)
- Docker images (api, web) built and booted locally; `/health/ready` verified
- Bugs found and fixed: lost WhatsApp message after a crash mid-webhook; SSRF/redirect hole in media download; no CSP on the web app; SMTP without auth/TLS; open-redirect variant; invalid `.env.example`; concurrent queries on one connection (14 sites); unauthenticated `/auth/refresh` logged a serialisation error; a flaky automation test (order-dependent)
- **Not verified / not done:** AWS deployment and managed-database PITR restore; CI on GitHub (incl. the new e2e job); real Razorpay, Meta, LLM (so AI reply p95 is unmeasured) and email; mobile/Firefox/WebKit; an independent security review; lawyer review of `docs/legal/`
- **Known minor issues:** a `pg` "already executing a query" deprecation warning still appears occasionally (one remaining concurrent-query site, not located); the lead-detail stage `<select>` fires one change per typed letter when typed on the keyboard (arrow keys work)

## Phase 8 verification (2026-11-17)
- `pnpm lint` ✔ · `pnpm build` ✔ · `pnpm test` ✔ (**19 DB + 487 API tests**) · `scripts/e2e.sh` ✔ (**26 Playwright tests** incl. MFA, axe a11y on 22+ screens in light/dark, mobile 390x844)
- Built: KMS key provider (fake-KMS tested), Turnstile bot protection (mock + stubbed fetch), TOTP MFA (users + platform), retention purge, workspace export/deletion, lead privacy UI, public API + webhooks, reports, support access, mobile/a11y pass (`docs/accessibility-and-responsive.md`), real-provider smoke scripts (`scripts/live/`, never run)
- **Not built (at the time):** WhatsApp Embedded Signup, Google Calendar sync (need real provider apps). The tenant MFA admin-reset UI was built afterwards (f016871); the visual automation builder is Phase 9
- **Not verified:** real AWS KMS, Cloudflare Turnstile, Razorpay, Meta, OpenAI (AI latency unmeasured), SMTP, AWS deployment, PITR restore, CI on GitHub, screen readers / real phones / Safari / Firefox
- **Open decisions:** support access default on vs opt-in; lawyer review of invoice retention after deletion and of `docs/legal/`; backup retention statement; `@axe-core/playwright` dev dependency (**decided: keep**); darker form-control borders (WCAG 1.4.11)
- **Known:** `webhooks-outbound.test.ts` flaked once in 4 runs earlier (cause not found); the `pg` concurrent-query deprecation warning can still appear

## Phase 9 verification: automation builder and industry packs (2026-11-17)
- Final gate on the combined tree: `pnpm lint` ✔ (8/8) · `pnpm build` ✔ (6/6) · `pnpm test` ✔ (**556 API, 33 web, 19 DB, 10 validation**) · `scripts/e2e.sh` ✔ (**43 Playwright tests**, incl. automation builder spec 12, industry packs spec 13, canvas spec 14, axe 0 violations in light/dark on the new pages).
- **Milestone 1:** graph schema + `validateGraph`/`summarizeGraph`/`linearToGraph`, immutable `automation_versions`, `WAITING` runs resumed by the minute scanner, `replied`/`timeout` wait exits, opt-out and disable end waits, optimistic concurrency (409), validate/versions endpoints, dry-run path. No on/off flag: linear automations run through the graph executor (ADR 0010).
- **Milestone 2:** Outline editor (keyboard operable, undo/redo, live summary, per-step validation, dry-run on the unsaved draft, unsaved-changes guard); the shared `Dropdown` now ignores synthetic pointer events (fixed the Enter-key bug, also on the Team menu). Browser Back is not intercepted.
- **Milestone 3:** Canvas | Outline switch over one shared reducer; `@xyflow/react` pinned 12.12.1 (MIT, 15 days old at install, audit clean; ADR 0010); loop-refusing connections, Tidy (own layout), test and past-run overlays, `GET /automations/runs/:id`; canvas read-only on phones.
- **Milestone 4:** 8 graph templates (5 general, 1 each for coaching, clinic, home services); legacy `trigger/conditions/actions` columns are a read-only mirror of the graph (removal plan in ADR-0072); review pass found no cross-tenant, pinning or duplicate-send problem; fixed one robustness issue (an unreadable definition broke matching and scans for a workspace); user guide `docs/user-guide/building-an-automation.md`.
- **Industry packs v2 (ADR 0011):** pack-driven lead form, appointment noun, scoring defaults, AI guidance (clinic: no medical advice), industry-tagged templates; Properties hidden unless the pack enables it and the industry was chosen (`industryChosen`); industry switch in onboarding re-seeds an empty workspace.
- **Not verified:** real WhatsApp sends after a wait; worker restart while waiting; load with many waiting runs; screen readers, Safari/Firefox/real phones; auto-layout quality on large graphs; template and pack wording with real operators; real providers (Razorpay, Meta, OpenAI, SMTP, KMS, Turnstile, AWS).
- **Known flakes:** `appointments.test.ts` 12-way booking race failed twice under heavy parallel load (passes alone; the test now prints unexpected statuses); the real-BullMQ-workers test in `automation.test.ts` timed out once under load (5 of 6 reruns pass).
- **Follow-ups:** purge of `automation_runs`/DRY_RUN rows and old versions (needs a DELETE grant and retention change); pinned-version cooldown; drop legacy columns per ADR-0072; automation trigger labels still say "visit"; dashboard says "Leads"; WhatsApp template names (`reengage_lead`, `enrolment_nudge`, `consultation_checkin`, `quote_followup`, `demo_class_reminder`, `consultation_reminder`, `inspection_reminder`) need registering with Meta by each tenant.

## Industry wording and backend follow-ups (2026-11-17)
- **Industry wording:** `packTerms()`/`useTerms()` give every noun form per pack (Lead/Enquiry/Customer, plural, article, appointment word). Nav, headings, buttons, dashboard, reports, pipeline, lead pages, settings, onboarding, AI tabs, notification prefs, and the automation triggers, templates, builder forms, summary and test dialog follow the pack. `summarizeGraph(graph, terms?)` is backward compatible, and real estate output is pinned by tests (ADR 0011 addendum). Remaining: report column titles from the API still say "Lead"; usage page, public API docs and the WhatsApp template example stay generic; installed automations keep stored names.
- **Automation history retention:** migration `20261117110000_automation_retention`, `purge_automation_data()`: DRY_RUN runs 7 d, finished runs 180 d, unreferenced non-live versions 365 d; QUEUED/RUNNING/WAITING runs, the live version and referenced versions never purged; the app role still has no DELETE; per-workspace override via `PUT /privacy/retention` (no UI). Cooldown now read from the pinned version (ADR-0074).
- **Flakes:** the appointments 12-way booking race was a real bug (a Postgres deadlock victim returned 500; now retried, ending as 409; 44/2400 failures under load before, 0/3000 after). The real-BullMQ-workers test was disturbed by a foreign process running workers on the shared DB (the test now detects it and skips with a warning). `webhooks-outbound.test.ts` did not reproduce in 14 runs; cause unconfirmed.
- **Verified locally:** lint, build, `pnpm test` (564 API, 39 web, 11 validation, 19 DB), `scripts/e2e.sh` 43/43.
- **Not verified:** retention on large data; the deadlock retry under real production concurrency; wording with real operators; the pipeline screenshots were not reviewed.

## webhooks-outbound flake resolved (2026-11-17)
- **Root cause:** another process on the shared DB with `WORKERS_ENABLED=true` (an e2e API, `apps/worker`, a forgotten background API) drains webhook deliveries of every workspace with its own settings (private targets blocked, other retry limits), so the test's localhost deliveries end "Blocked" or with wrong attempt counts and its wait times out. Reproduced: 5 of 8 runs failed with such an API running next to the test; 0 of 10 quiet and 0 of 15 CPU-loaded runs failed. Not the cause: CPU load, test order, the 400 ms receiver timeout, overlapping files (`fileParallelism` is off).
- **Fix (tests only):** shared `foreignOutboxConsumerPresent()` in `apps/api/test/helpers.ts` (also used by the BullMQ test in `automation.test.ts`); the webhook delivery tests skip with a reason when a foreign consumer is present (8 of 8 runs with a foreign API: 0 failures); the wait timeout message names the cause; runbook note added.
- **Not verified:** a foreign consumer that starts after the 3 s probe; with one present 11 of 14 tests are skipped, so coverage is reduced.

## Monitoring, milestone 1: logging and error pages (2026-11-17)
- **Built:** structured JSON logger for API and worker (`LOG_FORMAT`/`LOG_LEVEL`), request context (requestId, tenantId, userId, jobId) on every line, `redact()` for emails/phones/ids/tokens/secrets on messages, fields and stacks, mail subjects no longer logged, 500 logging with a stable error fingerprint, crash handlers (log, flush, exit 1), web `error.tsx`/`global-error.tsx`/`not-found.tsx` with a reference id (`ApiError` carries the request id), dev-only `/dev-error` (404 in production), env vars for milestones 2-3 reserved, `docs/monitoring.md`.
- **Verified locally (combined tree):** lint, build, `pnpm test` (584 API, 44 web, 19 DB, 11 validation), `scripts/e2e.sh` 54/54 (spec 16 error pages 4/4), real API run with JSON logs.
- **Not verified:** a real log collector/CloudWatch; the error boundary end to end (render test only); the request id is not carried into background jobs; no client error beacon.
- **Next:** milestone 2 (metrics, `ops_health_snapshot()`, worker heartbeat, EMF output), milestone 3 (alert rules, `ops_alerts`, email, Ops Status page), milestone 4 (IaC example, docs).

## Monitoring, milestone 2: metrics, health snapshot, heartbeat (2026-11-17)
- **Built:** in-process metrics registry (fixed dimension lists, series cap, no ids as labels); request, job, AI and billing outcomes recorded; CloudWatch EMF output every `METRICS_INTERVAL_SECONDS` (default on in production), final flush on shutdown; `ops_health_snapshot()` (migration `20261117120000`, SECURITY DEFINER, counts and ages only); the once-a-minute maintenance tick publishes 22 gauges plus queue depth and worker heartbeats and stores the latest snapshot in Redis (`<QUEUE_PREFIX>:ops:snapshot`, 5 min); worker heartbeat key (30 s, 90 s lifetime). 23 billable CloudWatch series, the rest are log fields.
- **Verified locally (my own run on the committed tree):** lint, build, `pnpm test` (602 API, 44 web, 19 DB, 11 validation; new: metrics 12, ops-health 6), `scripts/e2e.sh` 54/54, plus a real run on port 4300 with workers on (EMF lines, gauges for a seeded failed outbox event and unprocessed billing event, Redis snapshot, heartbeat removed on shutdown).
- **Not verified:** real CloudWatch reading the lines; CloudWatch cost for your region; per-instance p95 aggregation. A stuck RUNNING run self-heals within a minute when a worker is up, so that gauge is only non-zero without a worker.
- **Next:** milestone 3 (alert rules, `ops_alerts`, alert emails, `/platform/ops` page), milestone 4 (IaC example, docs).

## Editor focus race fixed (2026-11-18)
- **Root cause:** after an edit the Outline/Canvas asked for focus on the new step at ~0 ms and again at ~260 ms (to undo a closing menu handing focus back to its trigger). Both timers outlived the user's next action, so on a slow page an earlier "Add action" request took focus away from the step settings the user had just opened with Enter (spec 12 keyboard flow), or from a control they had just focused. Keyboard and screen-reader users lost their place.
- **Fix:** one rule (`apps/web/lib/focus-request.ts`): a request moves focus only if the user has not moved it since (still on the pressed button, dropped to the page, or on a menu trigger); opening a step cancels pending requests; `scheduleStepFocus` is shared by Outline and Canvas.
- **Verified:** unit tests with fake timers (7) and a reducer test; two deterministic e2e tests that control page timers (fail 10/10 on the old code, pass 10/10 on the new); spec 12 x30 = 150/150; lint, build, web 52 tests, full e2e 60/60. Not verified: screen readers. A partial first fix (guarding only the late check) still failed 1 of 120 runs, which led to the second rule.

## Monitoring, milestone 3: alert rules, alert email, Ops Status page (2026-11-18)
- **Built:** 11 alert rules (`alert-rules.ts`, thresholds in one table) evaluated once a minute against the health snapshot and live worker heartbeats, from the worker's maintenance job and an API timer behind a Redis lock; state in platform-only `ops_alerts` (migration `20261117130000`, RLS, no delete for the app role); fire after N consecutive breaches, resolve after 2 fine evaluations, compare-and-set transitions (racing evaluators send each email once); plain-text email via `MailService.sendAlert` to `ALERT_EMAIL_TO` or active platform admins, 15-minute damping, Sev 1-2 repeat every `ALERT_REPEAT_HOURS`; a structured ERROR/INFO log line per transition; `AlertsFiring` metrics (24 billable CloudWatch series); `GET /platform/ops` (platform session only, read-only) and the console page "Ops status" (firing alerts, health, workers and queues, SLO table, all rules, recently resolved, 30 s refresh, stale warning). Docs, runbook pointers, threat model and sub-processor note updated.
- **Verified locally (my own run on the tree):** lint, build, `pnpm test` (630 API, 52 web, 19 DB, 11 validation; new: alert-rules 13, alerts 15), `scripts/e2e.sh` 60/60 (spec 17 Ops status 4/4: axe light and dark, 375 px). The milestone fork also ran a live check on port 4100: a failed outbox event produced a firing email in about 100 s, then a resolved email once fixed and the damping window passed (Mailpit: 1 firing + 1 resolved); Ops page screenshots reviewed.
- **Not verified:** real inbox delivery; CloudWatch log filters; `worker_not_running` and `snapshot_stale` only in unit/DB tests, not with a real stopped worker; an external probe of `/health/ready` is still required (a dead app cannot email).
- **Next:** milestone 4 (IaC example for CloudWatch alarms and an external probe, awslogs settings, remaining docs).

## Monitoring, milestone 4: AWS example, external probe, runbook map, final docs (2026-11-18)
- **Built:** example CloudFormation template (`infrastructure/monitoring/cloudwatch-alarms.example.yml`): SNS topic + email subscription, 3 log groups with retention, 4 log metric filters (2 custom metrics: in-app "alert firing" lines, level=fatal crash lines), 15 alarms (5xx rate, analytics and webhook p95, automation and billing job failures, worker not running, in-app alert lines, process fatal, ALB 5xx and healthy hosts, RDS cpu/storage/connections, Redis memory/evictions) plus 1 optional ECS task-count alarm; awslogs settings, monitoring env vars, health checks and worker-health notes in the ECS reference; monitoring env vars in the compose example; `docs/runbooks/external-uptime-probe.md` and `scripts/probe-health.mjs` (dependency free; exit 0/1/2; `--expect-ready`, `--strict-redis`, `--timeout`, `--quiet`); alert-to-runbook map in `docs/monitoring.md` with a test (`alert-runbooks.test.ts`) that fails when a rule's runbook link breaks; `docs/slos-and-alerts.md` states where each SLO is measured; launch-checklist monitoring items; a "verified / not verified" section.
- **Fixed:** `webhooks.md` had no section for two alerts that point at it (`outbound_messages_failing`, `webhook_deliveries_failing`): added both. The `webhook_deliveries_failing` alert counted every disabled endpoint, including ones a team member switched off on purpose, so it fired forever; migration `20261118100000_ops_snapshot_auto_disabled_only` makes `ops_health_snapshot()` count only endpoints the dispatcher switched off automatically (test added).
- **Verified locally:** lint, build, `pnpm test` (652 API, 52 web, 19 DB, 11 validation; new: probe-health 7, alert-runbooks 14, snapshot fix 1); the template parses as YAML and every `!Ref` resolves.
- **Not verified:** everything AWS-side (template never deployed, never checked by cfn-lint or AWS; EMF to metric path; costs not priced for any region); the probe on a real service; real inbox delivery.
- **Monitoring plan status:** milestones 1-4 complete locally. What remains needs an AWS deployment and real accounts.

## WhatsApp Embedded Signup, milestone 1: backend with the mock (2026-11-18)
- **Built (off by default, `EMBEDDED_SIGNUP_MODE=off`):** settings and startup validation (`EMBEDDED_SIGNUP_MODE`, `META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`); client calls `exchangeCode`, `verifyPhoneInWaba`, `subscribeApp`, `unsubscribeApp` (live and mock); migration `20261118110000_whatsapp_phone_global_unique` (a WhatsApp number can belong to one workspace only, enforced by a unique index, plus `find_channel_by_phone_number_id()` returning only id/workspace/status/mode); `POST /channels/whatsapp/embedded` (server-side code exchange, WABA check, app subscription, sealed token, idempotent reconnect, 409 for a number owned by another workspace or connected manually); platform webhook `GET/POST /webhooks/whatsapp` (platform secret, routing by phone number, split per workspace, per-workspace stored payload); shared `WhatsappWebhookProcessor` (manual webhook refactored onto it, no behaviour change); disconnect unsubscribes best effort; manual credential rotation refused for platform channels; channel view shows `mode`. Log redaction widened (snake_case secret names, Meta `EAA…` tokens). ADR 0012, webhook runbook, live-verification and launch-checklist items.
- **Verified locally:** lint, build, `pnpm test` (682 API, 52 web, 19 DB, 11 validation; new: embedded-signup 23, whatsapp-embedded-client 7), `scripts/e2e.sh` 60/60 (manual connection path unchanged).
- **Not verified (everything Meta-facing):** the live client has never been run against Meta (`POST /oauth/access_token`, `GET /{waba}/phone_numbers`, `POST`/`DELETE /{waba}/subscribed_apps`); the Embedded Signup pop-up message and configuration, token lifetime, whether a phone PIN registration is needed, app review permissions, CSP hosts. A Meta Tech Provider registration is a prerequisite.
- **Next:** milestone 2 (web button with Facebook SDK, CSP, mock-mode E2E, WhatsApp card changes), milestone 3 (health check, `NEEDS_RECONNECT`, deauthorize and data-deletion callbacks, template sync), milestone 4 (live verification).

## WhatsApp Embedded Signup, milestone 2: web side (2026-11-18)
- **Built (mock only; off by default):** `GET /channels/embedded-signup` (mode, public app id and configuration id, never the secret); `apps/web/lib/embedded-signup.ts` (Facebook SDK loaded only on click, origin-checked window messages, a collector that needs the login code and the phone/WABA ids in either order, cancel is not an error); `EmbeddedSignupButton` (live Facebook path, plus a development-only stand-in dialog in mock mode that feeds the same server call); WhatsApp card: Facebook is the main button when enabled, "Advanced: use my own Meta app" opens the manual form, Facebook-connected numbers show no webhook URL or verify token, "Reconnect with Facebook"; CSP additions for Facebook hosts; ADR 0012 and live-verification notes.
- **Verified locally:** lint, build, `pnpm test` (684 API, 59 web, 19 DB, 11 validation; new web: embedded-signup 7), `scripts/e2e.sh` 66/66 (new spec 18: connect through the mock, a signed message arriving through the platform webhook, a forged signature refused, disconnect and reconnect, manual path still offered, a number owned by another workspace refused, axe in light and dark, 375 px).
- **Test-timing note:** axe can flag a toast or a dialog that is still fading in as low contrast (seen once for each, in a full run under load; a settled toast and dialog were probed clean). The spec waits for toasts to leave and for the dialog to be fully opaque.
- **Not verified (everything Meta-facing):** the real Facebook pop-up and the message it posts, `authResponse.code` from the SDK login, the CSP host list (a best guess from Meta's documentation), token lifetime, and whether a phone PIN registration is needed.
- **Next:** milestone 3 (health check, `NEEDS_RECONNECT`, deauthorize and data-deletion callbacks, template sync), milestone 4 (live verification).

## WhatsApp Embedded Signup, milestone 3: staying connected, Meta's callbacks, templates (2026-11-18)
- **Built (mock only; off by default):** channel status `NEEDS_RECONNECT` (sends refused, card shows "Reconnect needed" and a Reconnect with Facebook button); daily health check of every Facebook-connected token (`ops/channel-health.ts`, once per channel per day; a definite revoked-token answer flags it and notifies the owners once, a passing failure changes nothing, a recovered token reactivates the channel, a token expiring within 7 days warns once a day); Meta account notices (`account_update` removal events) on the platform webhook flag the channels of that WABA at once (audit + outbox event + owner notification); read-only template sync (`POST /whatsapp/templates/sync`, "Sync from WhatsApp", and once after connecting) with `source`/`approval_status`/`synced_at`, hand-typed templates never overwritten (clashes reported), only APPROVED synced templates can be sent (inbox and automation preview); Meta's deauthorize and data-deletion callbacks (`signed_request` verified, `meta_data_requests` platform-only table storing only a hash of the Facebook user id, `GET /webhooks/meta/data-deletion/:code`, public page `/data-deletion`); migrations `20261118120000`..`20261118124000`; ADR 0012 milestone 3, runbooks and launch-checklist items.
- **Verified locally:** lint, build, `pnpm test` (709 API, 59 web, 19 DB, 11 validation; new: channel-health 12, template-sync 4, meta-callbacks 7, client 2), `scripts/e2e.sh` 71/71 (spec 18 now 11 tests: synced templates, reconnect-needed state and recovery, deletion callback and its status page, axe light and dark, 375 px).
- **Not verified (everything Meta-facing):** the `account_update` event names and `waba_info` field, the error codes that mean a revoked token (190, 102, 463, 467), the `signed_request` format and whether Meta posts form-encoded, `GET /{waba}/message_templates` fields and paging, token lifetime. A Facebook user id is not mapped to a channel, so a deauthorize cannot flag a channel by itself (the daily check and account notices cover revocation).
- **Next:** milestone 4 (live verification with a real Meta test account and the Tech Provider registration, which only you can start).

## Meta registration documents (2026-11-18)
- **Written (documentation only, nothing submitted to Meta):** `docs/meta-registration/` with `README.md` (the order of work from Business Verification to going live, who does what, how Meta values map to `META_*` settings, risks), `app-review-submission.md` (App Review texts for `whatsapp_business_management` and `whatsapp_business_messaging`, written only from what the product does), `review-video-scripts.md` (scene-by-scene recording scripts and a pre-recording checklist), `legal-wording.md` (draft Tech Provider wording for the DPA, privacy policy, terms and sub-processor list, with a clinics caution; **a lawyer must review**). Existing legal drafts updated: the Meta row in `sub-processors.md` points to the new wording, and a stale note in `privacy-policy.md` (retention jobs and self-service erase/export) now says they exist. Launch checklist points to the new folder.
- **Claims corrected while writing:** the product does not display a number's quality rating, and consent shows in the conversation details panel (not on the lead page): the documents say so.
- **Flagged for Milestone 4:** Meta's pages say Embedded Signup versions 2 and 3 are being deprecated (October 2026 dates, already past); the code sends the version 3 setting and uses Graph API v21.0, so the current versions must be checked and the code updated before real testing and recording.
- **Needs you:** company details and documents for Business Verification, public privacy/terms pages (lawyer-reviewed), Meta developer app and Embedded Signup configuration, a staging address, a test WhatsApp account and number.

## Customer portal for leads, milestone 1 & 2 (2026-11-25)
- **Built:** Milestone 1 backend (`portal_configs`, `portal_login_codes`, `portal_sessions` under RLS, OTP sign-in) + Milestone 2 customer actions (`POST /portal/appointments/:id/confirm`, `cancel`, `reschedule`, `GET /portal/appointments/:id/slots`, `POST /portal/data-request`, staff notifications) + Web UI at `/p/[key]` (OTP sign-in, upcoming/past appointments, confirm/reschedule/cancel dialogs, My Data & privacy request form).
- **Verified locally:** lint, build, `pnpm test` (731 API incl. new portal 17 and portal-auth 5, 59 web, 19 DB, 11 validation), `scripts/e2e.sh` 71/71.
- **Not verified:** real email delivery; WhatsApp codes against Meta (Meta's authentication templates normally need a code button that the template sender does not support yet, so this path may need a change when tested live); no web screens yet.
- **Next:** milestone 2 (confirm, cancel, reschedule through the booking engine, staff notified "by the customer", "my data" requests, session revocation when a lead is erased or merged).

## New-message notifications and live alerts (2026-11-18)
- **Gap found:** a customer writing in (website chat or WhatsApp) created no notification: only the Inbox badge count changed, nothing popped up, and the handover notification linked to `/conversations?c=…`, a page that does not exist.
- **Built:** notification type `new_message` (owner of the chat, or owners and managers when nobody owns it; for an AI-handled chat only the first message interrupts a person; a burst within a minute is one notice; respects each person's mute choice); the handover link now goes to `/inbox?c=…`; live events carry title, preview and link; the app pops up a notification on any page (not for a new message while the Inbox is open and in front), puts the unread count in the browser tab title, offers opt-in desktop alerts when the tab is in the background, and after the live connection drops and returns it announces what arrived meanwhile; the website chat widget now keeps polling when its tab is in the background (every 8 s, 2 s in front, and at once when the visitor returns) so replies from the team appear without switching back; `lib/alerts.ts` (tested helpers).
- **Verified locally:** `pnpm test` (737 API incl. new-message-notification 6, 63 web incl. alerts 4, 19 DB, 11 validation), build, `scripts/e2e.sh` 70 of 71. The failing check is `11-mobile` "dialogs fit the phone screen", which opens the Add-lead dialog: it fails because of other uncommitted changes to `components/ui/dialog.tsx` and `lead-form-dialog.tsx` in the working tree (not part of this work; it passed in the previous full run). Lint: errors only in `tasks/page.tsx` and `task-drawer.tsx` (also not part of this work).
- **Not verified:** a real desktop notification and sound on a device; Web Push (closed browser) is not built.

## Notification sound and desktop alerts while in another application (2026-11-18)
- **Added:** per-person settings saved on the account (`user_alert_settings`, no tenant column, a missing row means the defaults: sound on at 50%, desktop alerts on; `GET/PUT /me/alert-settings`). The bell's "Notification settings" dialog has a "Sound and alerts" section: sound on/off, volume, Test sound, desktop alerts on/off and the per-browser permission state. Every new notification beeps (a two-tone Web Audio beep, no audio file; at most one beep per 3 s, shared across open tabs). A desktop alert now fires when the person is in another tab or another application (tab hidden or window not focused), not only when the tab is hidden; one alert per notification across tabs.
- **Limits:** works only while a LeadPilot tab is open (Web Push for a closed browser is not built). Browsers allow sound only after one click or key press on the page; the dialog says so. System Do Not Disturb modes silence desktop alerts by design.
- **Verified locally:** web unit (alerts 14), API (alert-settings 5), full `pnpm test`, and E2E `19-alert-settings` (3: saved on the account, survives reload and a second browser, axe; new chat while away gives one beep and one alert, each switch silences only its own; no alert while looking at LeadPilot).
- **Not verified:** real sound and a real system notification on a device.
