# LeadPilot AI — Progress

Legend: ☐ pending · ◐ in progress · ☑ done (verified) · Tags: **M** = MVP, **V** = V1.1, **L** = Later
Last updated: 2026-11-16 · Current phase: **Phase 3 (Communication): built and verified against a MOCK WhatsApp provider; awaiting user review**

## Phase status
| Phase | Status |
|---|---|
| 0 Plan | ☑ approved |
| 1 Foundation | ☑ |
| 2 CRM | ☑ |
| 3 Communication | ◐ built; verified with mock provider only (see below) |
| 4 AI | ☐ |
| 5 Automation & appointments | ☐ |
| 6 SaaS | ☐ |
| 7 Hardening & launch | ☐ |

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
- ◐ M App shell: sidebar (collapse), header (workspace switcher, command palette, theme, profile), breadcrumbs component. **Not built yet:** quick-create button (nothing to create until phase 2), notifications bell (phase 5), global search beyond navigation commands
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
- ☐ M Provider abstraction, orchestrator, prompt versioning
- ☐ M Ten tools with validation + idempotency + audit
- ☐ M Knowledge base pipeline (upload, scan, extract, chunk, embed, search)
- ☐ M RAG with tenant isolation + citations
- ☐ M Requirement extraction, rule-based scoring, manager override
- ☐ M Handover / takeover
- ☐ M Usage metering, hard caps, kill switch
- ☐ M Eval harness (≥30 cases) + injection corpus
- ☐ M English + Hindi/Hinglish
- ☐ V Voice-note transcription · ☐ V Additional Indian languages

### Automation, appointments, notifications (Phase 5)
- ☐ M Appointments (CRUD, availability, calendar+list, no double booking)
- ☐ M Reminders/confirmations
- ☐ M Outbox + BullMQ workers, DLQ
- ☐ M 8 automation templates, history, retries, dry-run
- ☐ M In-app notifications + preferences
- ☐ M SLA tracking + alerts
- ☐ M Basic usage tracking
- ☐ V Email / WhatsApp-to-staff / web push notifications · ☐ V Google Calendar · ☐ L Visual workflow editor

### SaaS (Phase 6)
- ☐ V Plans/entitlements (DB-driven), Razorpay subscriptions, GST invoices, dunning/grace, trial
- ☐ V Quotas + alerts, full usage dashboards
- ☐ V Platform super admin (tenants, MRR, usage, health, plans, impersonation audit)
- ☐ V Public API + outbound webhooks
- ☐ V Reports & CSV export (full set)
- ☐ V Compliance workflows (consent, export, erasure, retention)

### Quality & launch (Phase 7)
- ☐ Full E2E suite · ☐ Security review · ☐ Load test vs budgets · ☐ Backup/restore drill
- ☐ Runbooks · ☐ Deployment guide · ☐ SLOs/alerts · ☐ Legal templates reviewed

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

## Decisions needed from the user
1. ☑ Phase 0 plan approved.
2. ☑ `git init` done; **no remote, work stays local** (decided 2026-11-16).
3. ☑ TypeScript 6.0.3 and Prisma 7.10.1 (ADR-0008) agreed.
4. ☑ **WhatsApp billing: tenants pay Meta directly on their own WABA** (decided 2026-11-16). LeadPilot plans price the software only; no WhatsApp resale or margin.
5. **LLM default model** and who holds the API key in dev. The brief only says OpenAI. I need a dev key later; I will not use it until you provide it.
6. **Meta test assets:** still needed to verify the live WhatsApp client. Do you have a Meta developer account / WhatsApp test number? (Phase 3 was verified with the mock provider.)
7. **Email provider** for transactional mail (SES, Resend, other). Mailpit is used locally.
8. ☑ Lead = person record in MVP (ADR-0010) agreed.

## Assumptions made (unless you object)
- pnpm + Turborepo; SSE for real-time; AWS ECS/Fargate as the reference deployment.
- Manual WhatsApp token entry for MVP, Embedded Signup in V1.1.
- Brief prices are ex-GST.
- English + Hindi/Hinglish for the AI in MVP.
