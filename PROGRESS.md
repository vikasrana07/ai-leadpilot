# LeadPilot AI — Progress

Legend: ☐ pending · ◐ in progress · ☑ done (verified) · Tags: **M** = MVP, **V** = V1.1, **L** = Later
Last updated: 2026-11-16 · Current phase: **Phase 8: built and verified locally; NOT launch-ready; every real provider (Razorpay, Meta, OpenAI, SMTP, AWS KMS, Turnstile) and AWS deployment are unverified; awaiting user review**

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
| 8 Launch blockers, V1.1, polish | ◐ built and tested locally (see Phase 8 verification); real KMS/Turnstile/Razorpay/Meta/OpenAI/SMTP unverified; Embedded Signup and Google Calendar NOT built |
| 9 Visual automation builder | ◐ milestones 1-4 built and tested locally: graph model + versions + waits + API (c46972f), Outline editor, canvas (@xyflow/react 12.12.1), graph templates, user guide; real WhatsApp after a wait, worker restart while waiting, load with many waiting runs unverified |
| 9b Industry packs v2 | ◐ coaching, healthcare, home services packs; pack-driven lead form, wording, scoring, AI guidance (7bd66f1); content needs review by people in each trade; clinic WhatsApp use needs legal review |
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
- ☑ M Onboarding wizard, resumable. Steps 1-3 functional; steps 4-7 depend on phases 3-4 and are explicitly skippable (not faked)
- ☑ M Register / login / logout / verify email / forgot+reset password
- ☑ M Refresh rotation with reuse detection; session list/revoke
- ☑ M Invitation-based signup
- ☑ M Roles + granular permissions (32 keys), guards; roles UI is read-only
- ☑ M Audit log (append-only at DB grant level) + viewer
- ☑ M RLS on all tenant tables + isolation test suite
- ☑ M Design tokens, light/dark/system theme, no-flash inline script (visually confirmed dark persistence; flash itself not measured)
- ◐ M App shell: sidebar (collapse), header (workspace switcher, command palette, theme, profile), breadcrumbs component. **Not built yet:** quick-create button (nothing to create until phase 2), global search beyond navigation commands
- ◐ M i18n infrastructure: **not done** (strings are inline English). Carry to phase 2
- ☐ V Permission overrides per member · ☐ L Fully custom roles
- ☑ Responsive: verified in an emulated 390px viewport (phase 2): drawer nav, stacked filters, lead cards instead of a table, single-column dashboard. Kanban scrolls horizontally on phones by design
- ☑ Design-review screens (sample data, labelled, not connected): /design/dashboard, /design/inbox, /design/lead, /design/pipeline
- ☑ Design pass 2 (2026-11-16, from user reference images): navy sidebar + tinted header tokens, KpiCard (count-up, delta, sparkline), inbox queue rail with counts and a "Join conversation" takeover. Pass 3 (user chose): deeper near-black navy #0e1433, denser cards (26px KPI numbers, tighter padding, 13px base type). Awaiting user feedback

### CRM (Phase 2)
- ☑ M Lead CRUD, soft delete, search (trigram-indexed), filters, sort. **Deviation:** page/offset pagination with totals instead of cursor (simpler UI, fine at the budgeted scale; revisit if lists exceed ~100k)
- ☑ M CSV import (two-step: dry-run report then confirm; Indian amounts like "85 L", "1.2 Cr") / export (formula-injection safe)
- ☑ M Bulk assign / stage / tag / delete with per-lead failure report
- ☑ M Duplicate detection (any phone format, email), override, lead merge + audit (history of merged leads stays on the survivor)
- ◐ M Activity timeline, notes, tags, custom fields ☑ · **attachments deferred to phase 4** (needs the file-storage + virus-scan pipeline built for the knowledge base)
- ☑ M Lead detail page (loading / error / empty / success states)
- ☑ M Lead capture API (API key, hashed at rest, shown once, revocable) + Integrations page. Repeat enquiries append to the existing lead. Server-to-server only; browser capture arrives with the widget public key (phase 3)
- ☑ M Pipeline Kanban (drag-drop + keyboard-accessible move menu, optimistic update with rollback), stage config, transition history, lost reasons, server-enforced transition rules
- ☑ M Property inventory (CRUD, filters, CSV import); `PropertiesService.where()` is the structured-data source for the AI `search_properties` tool in phase 4
- ☑ M Industry Pack loader (real estate + general pack), idempotent, never overwrites tenant edits; backfill + system-role sync run on migrate
- ☑ M Dashboard from real data: KPIs with deltas, acquisition trend, pipeline, sources, hot leads, follow-ups, agent table, date ranges incl. custom, tenant-timezone aware. Appointment/AI/automation tiles intentionally absent until those modules exist (API returns null, never invented)
- ☑ M Team workload + round-robin assignment (safe under concurrent creates)
- ◐ M i18n: message-catalogue scaffold + ₹ lakh/crore formatting only. Most strings are still inline English
- ☐ V Portal email parsing · ☐ L Meta Lead Ads · ☐ L Google Sheets
- ☐ Lead scoring itself is phase 4 (score/temperature can be set manually; seeded demo scores are demo data)

### Communication (Phase 3)
- ☑ M Conversations/messages, 3-panel inbox (single-pane on mobile), unread counts, queues, filters, search, assign, close/reopen, takeover, internal notes, tags, delivery ticks, media rendering, failed-send retry
- ☑ M Real-time via SSE over Redis pub/sub, scoped per agent; live unread badge in the sidebar
- ◐ M WhatsApp Cloud API (manual token): connect/test/rotate/disable, webhook handshake + HMAC verification, inbound text/media/unsupported types, status receipts (monotonic), outbound text and templates, encrypted credentials. **The live Meta client is written but has never been run against Meta**; everything is verified with the mock provider
- ☑ M 24-hour window, opt-out (STOP) and consent enforced server-side; template registry (names of already-approved templates)
- ☑ M Webhook security: unguessable URL key, per-channel app-secret HMAC over raw body, payload/number match, dedupe by body hash and by message id
- ☑ M Website widget: public key + allowed origins, Shadow-DOM loader, lead capture, session tokens, polling, key rotation revokes sessions, admin UI with install snippet
- ◐ M Retries/rate limits: bounded inline retry + manual retry now; scheduled background retries in phase 5 (ADR-0016)
- ☑ Refresh-token race fixed (ADR-0015)
- ☐ V Embedded Signup · ☐ V Template manager/sync with Meta · ☐ V Canned replies · ☐ L Broadcasts · ☐ L Messenger/Instagram/Email
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
- ☐ M Attachments on leads (still deferred; needs a UI for file attach; storage and scanning now exist)
- ☐ V Voice-note transcription · ☐ V Additional Indian languages

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
- ☐ V Email / WhatsApp-to-staff / web push notifications · ☐ V Google Calendar · ☐ L Visual workflow editor

### SaaS (Phase 6)
- ☑ V Plans/entitlements (DB-driven, editable by platform admins), Razorpay subscriptions (mock-verified; **live client never run**), GST invoices (accountant review pending), dunning/grace, trial, plan gating in the backend
- ☑ V Quotas + 80%/100% alerts (owners notified once), plan-limit bars on the Usage page · ☐ V richer usage history/dashboards
- ☑ V Platform console (tenants, MRR, usage, plans, suspend/reactivate, complimentary/trial plans, audit) · ☑ V read-only support access (opt-out per workspace; default on: decision pending) · ☐ V platform health page
- ☑ V Public API (`/v1`, scoped keys, `api_access` plan feature) + outbound webhooks (signed, SSRF-safe, retried)
- ☑ V Reports (7) & CSV export (plan-gated)
- ☑ V Compliance workflows: lead export/erasure, retention purge, workspace export, workspace deletion (legal review of retained invoices needed)
- ☐ V WhatsApp Embedded Signup · ☐ V Google Calendar sync (both deferred: need real provider apps/credentials, ADR-0040)

### Quality & launch (Phase 7)
- ☑ Full E2E suite (12 Playwright tests, desktop Chrome, local; CI job written but never run on GitHub) · ☑ Security review pass (self-review; `docs/security-review.md`) · ☑ Load test vs budgets (`docs/performance.md`; AI reply latency unmeasured) · ☑ Backup/restore drill (logical dump; RDS PITR not drilled)
- ☑ Runbooks (9) · ☑ Deployment guide + Dockerfiles (images built and booted locally; AWS unverified) · ◐ SLOs/alerts (documented; only log/table-based SLIs measurable) · ◐ Legal templates (drafts written; **need a lawyer's review**) · ☑ DPDP single-lead export/erasure (API) · ☐ tenant-wide export/deletion, retention job, KMS key provider, bot protection, MFA (see security-review)

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
