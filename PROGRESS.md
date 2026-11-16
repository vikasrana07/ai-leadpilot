# LeadPilot AI — Progress

Legend: ☐ pending · ◐ in progress · ☑ done (verified) · Tags: **M** = MVP, **V** = V1.1, **L** = Later
Last updated: 2026-11-16 · Current phase: **Phase 2 (CRM): built and verified; awaiting user review**

## Phase status
| Phase | Status |
|---|---|
| 0 Plan | ☑ approved |
| 1 Foundation | ☑ |
| 2 CRM | ◐ built and verified (see below); awaiting your review |
| 3 Communication | ☐ |
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
- ☐ M Conversations/messages, inbox 3-panel UI, SSE
- ☐ M WhatsApp Cloud API (manual token): webhooks, inbound/outbound, statuses, media, templates (send)
- ☐ M 24-hour window + opt-in enforcement
- ☐ M Webhook signature verification, dedupe, idempotency
- ☐ M Website widget (public key, origins, theme, handover, rate limit)
- ☐ V Embedded Signup · ☐ V Template manager · ☐ V Canned replies · ☐ L Broadcasts · ☐ L Messenger/Instagram/Email

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

## Decisions needed from the user
1. ☑ Phase 0 plan approved.
2. ☑ `git init` done; **no remote, work stays local** (decided 2026-11-16).
3. ☑ TypeScript 6.0.3 and Prisma 7.10.1 (ADR-0008) agreed.
4. ☑ **WhatsApp billing: tenants pay Meta directly on their own WABA** (decided 2026-11-16). LeadPilot plans price the software only; no WhatsApp resale or margin.
5. **LLM default model** and who holds the API key in dev. The brief only says OpenAI. I need a dev key later; I will not use it until you provide it.
6. **Meta test assets:** do you have a Meta developer account / WhatsApp test number for sandbox verification in Phase 3?
7. **Email provider** for transactional mail (SES, Resend, other). Mailpit is used locally.
8. ☑ Lead = person record in MVP (ADR-0010) agreed.

## Assumptions made (unless you object)
- pnpm + Turborepo; SSE for real-time; AWS ECS/Fargate as the reference deployment.
- Manual WhatsApp token entry for MVP, Embedded Signup in V1.1.
- Brief prices are ex-GST.
- English + Hindi/Hinglish for the AI in MVP.
