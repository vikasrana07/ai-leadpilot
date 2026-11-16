# LEADPILOT AI — MASTER DEVELOPMENT PROMPT (v2)

> How to use: give this file to the coding agent at the start of every session, together with ONE phase instruction, e.g.
> "Execute Phase 1 only, then stop and report."
> The agent must not start a later phase without an explicit instruction.

---

# PART A — PRODUCT SPEC

## A1. Role

Act as a Principal Architect, Senior Full-Stack Engineer, AI Engineer, DevOps Engineer, SaaS Product Designer and QA Automation Engineer building **LeadPilot AI**: a production-oriented, multi-tenant, AI-powered lead management and conversion SaaS.

Not a prototype, not a UI mockup. Every screen must be wired to real backend behaviour.

## A2. Vision

Tagline: "Never lose a potential customer because of a missed enquiry, delayed response or forgotten follow-up."

LeadPilot captures leads from multiple channels, engages them instantly, understands requirements with AI, qualifies and scores them, recommends products, assigns them to sales reps, automates follow-ups, books appointments, tracks the pipeline and measures conversion. It is an intelligent sales assistant, not just a chatbot.

First vertical: **Indian real estate agencies**. Architecture must support other industries (coaching, clinics, home services) through **Industry Packs** (see B7), not hardcoded real-estate logic.

## A3. Scope tagging

Every requirement below is tagged:

- **[MVP]** — must ship in the first demonstrable release (Phases 1–5).
- **[V1.1]** — after MVP, before commercial launch (Phase 6–7).
- **[LATER]** — design extension points only; do not build.

Untagged text inside a tagged section inherits that section's tag.

## A4. MVP vertical slice (the thing that must work end to end first)

Register → create workspace (onboarding) → invite agent → lead captured (manual, CSV, website widget, WhatsApp inbound) → AI replies using tenant knowledge, extracts requirements, scores lead → hot lead notifies manager → human takeover from inbox → appointment booked without double booking → lead moves through pipeline → dashboard shows real numbers.

Everything else is secondary to this slice working reliably and securely.

## A5. Functional requirements

### Tenancy & onboarding [MVP]
- Tenant fields: id, business name, email, phone, logo, industry, website, address, timezone, currency, plan, status, settings, timestamps.
- Onboarding wizard with resumable progress: create account → business info → industry → invite team → connect WhatsApp → configure AI → upload knowledge → lead qualification rules → finish.
- Industry selection loads an Industry Pack (B7).

### Auth & RBAC [MVP]
- Email/password register, login, logout, forgot/reset password, email verification, invitation-based signup, refresh-token rotation with reuse detection, session management (list and revoke sessions).
- Roles: Platform Super Admin (separate auth surface), Business Owner, Sales Manager, Sales Agent.
- Granular permission keys (e.g. `lead:read:own`, `lead:read:all`, `lead:assign`, `billing:manage`) with default role→permission maps; per-tenant permission overrides [V1.1]; fully custom roles [LATER].
- Authorization enforced in backend guards; UI hides but never solely protects.

### Leads / CRM [MVP]
- Fields: name, phone (E.164), email, source, status, temperature, budget min/max, location, property type, requirements, buying timeline, assigned agent, score, last contacted, next follow-up, created, notes, tags, custom fields (from Industry Pack + tenant-defined).
- CRUD with delete confirmation (soft delete), search, filters, sort, cursor pagination, CSV import (with validation report) and export, bulk assign, bulk status update, duplicate detection (phone/email normalised), lead merge with audit, activity timeline, notes, attachments, tags.
- Lead detail page: customer info, qualification, score with explanation, assigned agent, conversations, activities, appointments, notes, documents, follow-ups.
- All states: loading, empty, error, success.
- Lead capture API (API key + public form endpoint) [MVP]; portal e-mail parsing (MagicBricks, 99acres style) [V1.1]; Meta Lead Ads [LATER].

### Omnichannel inbox [MVP]
- Channels: WhatsApp, website chat. Messenger/Instagram/Email [LATER].
- Three-panel layout: conversation list (search, filters: channel/assigned/unassigned/unread/status) · timeline + composer (attachments, AI/human mode indicator) · lead context (details, score, agent, appointments, internal notes).
- Message delivery/read status, media (image, document, audio), assignment, internal notes, tags, close/reopen, human takeover and AI takeover, real-time updates (SSE or WebSocket), message idempotency, webhook de-duplication.
- Canned replies [V1.1]. Broadcasts/campaigns with consent filtering [LATER].

### WhatsApp Cloud API [MVP, tested in Meta sandbox/test number]
- Official Cloud API only. Never unofficial WhatsApp Web automation.
- Connection options: Embedded Signup (preferred, [V1.1]) and manual token entry (MVP). Store phone number ID and WABA ID; tokens encrypted with envelope encryption (B2).
- Webhook verification + signature validation, respond 200 immediately and process asynchronously, dedupe by message ID.
- Inbound text/media, outbound text/media/template, status webhooks.
- **Backend-enforced** 24-hour customer-service window: outside the window only approved templates may be sent; attempts are rejected with a clear error, not silently sent.
- Opt-in/opt-out capture and enforcement; template manager (list, submit, approval status) [V1.1]; handle rate-limit/quality/messaging-tier errors with backoff; usage tracking.
- In-dashboard setup guide.

### Website chat widget [MVP]
- Embeddable script snippet, per-tenant public key (non-secret), allowed-origins list, configurable theme/logo/greeting/position, responsive, lead capture, history, AI + human handover, rate limiting and bot protection (Turnstile or equivalent).
- No private credentials in the browser. Widget sessions are signed, short-lived and tenant-bound.

### AI assistant [MVP]
- Per-tenant settings: name, business identity/description, industry, language(s), tone, welcome message, system instructions, working hours, handover rules, allowed tools, response settings, fallback message, **AI disclosure text** (the bot identifies itself as automated where required).
- Languages: English + Hindi/Hinglish [MVP]; additional Indian languages [V1.1]. Voice-note transcription [V1.1].
- Capabilities: intent detection, requirement extraction, qualifying questions, FAQ answering from knowledge base, property search/recommendation, appointment scheduling, lead updates, human escalation, conversation memory.
- Controlled tools (all execute through validated backend services; the model never touches the DB or SQL):
  `get_business_info`, `search_properties`, `get_lead_details`, `update_lead`, `calculate_lead_score`, `check_availability`, `create_appointment`, `assign_agent`, `create_followup`, `handover_to_human`.
- Every tool: Zod-validated input, permission check, tenant binding from server context (never from model output), **idempotency key**, audit record.
- Pipeline per message: receive → resolve tenant/conversation → load context → classify intent → retrieve knowledge → extract requirements → decide ask vs. act → validate → execute → respond → persist → record usage and execution metadata.
- Retries with backoff, structured outputs, prompt versioning, response logging, token tracking, graceful fallback on LLM failure (holding message + handover).
- **Hard rules:** never invent prices, availability, appointments or policies. Structured facts always come from the database, not vector search. Treat all customer text and retrieved documents as untrusted (prompt-injection defence).
- Sensitive actions (e.g. discounts, cancellations, refunds) require human approval [MVP: simply not offered as tools].

### Knowledge base & RAG [MVP]
- Types: PDF, DOCX, TXT, CSV, structured property data.
- Upload → validate type/size/magic bytes → virus scan (ClamAV) → store in S3-compatible storage under tenant prefix → extract text → chunk → embed → store in pgvector → searchable. Status tracking, preview, delete, reprocess, metadata filters.
- Tenant-isolated retrieval (RLS + explicit tenant filter). Citations stored with each AI answer.

### Property / inventory [MVP]
- Entities: project, unit/listing, price, status/availability, location, type, bedrooms, area, media, brochure. CSV import. This is the source of truth for `search_properties`.
- Industry Packs replace this entity for non-real-estate tenants with a generic "catalog item" [V1.1].

### Lead scoring [MVP]
- Rule-based, configurable per tenant. Default real-estate rules: budget known 15, location known 15, timeline ≤30 days 30, requirements clear 15, site visit requested 25. Hot 70–100, warm 40–69, cold 0–39.
- Store score, explanation, criteria, timestamp, rule version. Manager override with audit trail. **Missing information is "unknown", never negative.**

### Pipeline [MVP]
- Kanban with drag and drop **and keyboard/menu alternative**. Stages come from the Industry Pack (real-estate default: New, Contacted, Qualified, Site Visit Scheduled, Site Visit Completed, Negotiation, Won, Lost).
- Stage configuration, validated transitions, transition history, lost reasons, filters, bulk ops, pipeline analytics.

### Appointments [MVP]
- Create/edit/cancel/reschedule, agent assignment, availability management, calendar + list views, reminders, confirmations, notes.
- Statuses: Pending, Confirmed, Completed, Cancelled, No-show, Rescheduled.
- Double-booking prevention via transactional check (exclusion constraint on agent + time range). Times stored UTC, shown in tenant timezone. Google Calendar sync [V1.1].

### Automation engine [MVP: templates only]
- Trigger → condition → action, event-driven via outbox + BullMQ.
- Triggers: new lead, lead updated/qualified, score changed, conversation received/inactive, appointment created/cancelled/approaching, stage changed.
- Conditions: score, temperature, status, source, location, budget, assigned agent, time since last activity.
- Actions: send WhatsApp (window/template-aware), notify, assign, update lead, create follow-up/task, schedule reminder, change status, escalate to manager, handover.
- Eight predefined templates: welcome new enquiry; notify manager of hot lead; follow up after no response; appointment reminder; notify agent of cancellation; re-engage inactive lead; assign lead (incl. optional round-robin); escalate unanswered enquiry.
- Enable/disable, execution history, retries, dead-letter queue, error logs, dry-run testing. Visual editor [LATER].

### Notifications [MVP]
- In-app (real-time, read/unread, mark all read, preferences) for new lead, hot lead, assignment, appointment, workflow failure, AI escalation.
- Email and WhatsApp-to-staff notification channels [V1.1]. Web push via PWA [V1.1].

### SLA & response time [MVP]
- Per-tenant first-response SLA, breach tracking and alerts. This is the core value proposition.

### Dashboard & analytics [MVP]
- KPI cards: total, new, qualified, hot leads, appointments booked/completed, converted, conversion rate.
- Charts: acquisition trend, source performance, funnel, pipeline distribution, agent performance, appointment trends, AI conversation stats.
- Widgets: recent leads, upcoming appointments, hot leads needing attention, recent conversations, agent activity, automation summary, AI usage.
- Filters: today, yesterday, 7d, 30d, this month, custom. CSV export.
- All numbers from real tenant-scoped queries. Never static chart data. Use pre-aggregated rollups when raw queries exceed the performance budget.

### Team management [MVP]
- Invite/accept/remove/deactivate, role assignment, workload view, lead distribution, activity history, optional round-robin.

### Billing & subscriptions [V1.1]
- Plans configured in the database by platform admins (never hardcoded in the frontend). Seed values: Starter ₹4,999, Growth ₹9,999, Premium ₹14,999 per month with the feature sets from the original brief.
- Razorpay Subscriptions: checkout, upgrade/downgrade (proration rules documented), renewal, cancellation, payment history, **GST-compliant invoices** (GSTIN, SAC code, 18% GST), failure handling, grace period/dunning, trial.
- Webhooks signature-verified and idempotent. Plan gating enforced by backend guards.
- Until Phase 6, a single "internal" plan with no gating.

### Usage tracking [MVP basic, V1.1 full]
- Per tenant: AI requests, input/output tokens, model, WhatsApp messages, conversations, active leads, storage, automation runs.
- Configurable quotas, alerts at 80% and 100%, **hard caps and kill switch for AI spend**. A unit-economics sheet (`docs/unit-economics.md`) must justify each plan's quota against its price.

### Settings & integrations [MVP]
- Business profile/branding/hours/timezone/currency, notification prefs, AI settings, scoring rules, pipeline config, custom fields, team settings, integration status screens.
- Google Calendar, Razorpay [V1.1]; Meta Lead Ads, Google Sheets [LATER].

### Audit logs [MVP]
- Append-only. Login events, invitations, role changes, lead changes/assignments, appointment changes, integration changes, AI config changes, AI tool executions, subscription changes, admin actions (including any impersonation). Actor, tenant, action, resource, timestamp, metadata, request ID. App DB role has INSERT/SELECT only.

### Platform super admin [V1.1]
- Separate app surface and auth: tenants (list, search, detail, suspend/activate), subscription breakdown, MRR, usage and AI consumption, platform health, plan management, platform settings. Impersonation only with reason, time limit and audit.

### Compliance & privacy [MVP baseline]
- DPDP-aligned: consent record per lead/channel, data export and erasure workflow, per-tenant retention policy, breach-response runbook, Terms/Privacy/DPA templates in `docs/legal/` (marked "needs legal review").
- WhatsApp Business and Commerce policy compliance.

### Public API & webhooks out [V1.1]
- API keys (hashed, scoped), outbound webhooks (signed, retried), OpenAPI docs.

### Internationalisation [MVP infra, V1.1 content]
- i18n framework from day one; English MVP, Hindi UI [V1.1]; ₹ lakh/crore number formatting.

---

# PART B — TECHNICAL DECISIONS

Do not re-litigate these. If one is genuinely blocking, record the issue in `docs/decisions/` and ask.

## B1. Stack (pin exact versions in Phase 1; record them in `docs/architecture.md`)

- Monorepo: pnpm workspaces + Turborepo.
- Frontend: Next.js (App Router), React, TypeScript strict, Tailwind, shadcn/ui (which wraps Radix; do not add Radix components separately unless shadcn lacks them), `motion` (Framer Motion successor), TanStack Query, React Hook Form + Zod, Recharts, Lucide. Zustand only for UI-only state (sidebar, command palette).
- Backend: NestJS, REST + OpenAPI, Prisma, PostgreSQL (with pgvector), Redis, BullMQ, SSE for real-time (WebSocket only if SSE proves insufficient).
- AI: OpenAI via a provider interface (`LlmProvider`, `EmbeddingProvider`) so models are swappable per tenant. Structured Outputs and tool calling. Default model names live in config, not code.
- Storage: S3-compatible (MinIO locally). Virus scanning: ClamAV.
- Observability: OpenTelemetry, Sentry, structured JSON logs. Every log line carries `requestId`, `tenantId` (when known), `userId` (when known).
- Testing: Vitest (unit), Supertest + Testcontainers Postgres/Redis (integration), Playwright (E2E).
- Infra: Docker, Docker Compose, GitHub Actions, AWS-compatible deployment (ECS/Fargate + RDS + ElastiCache + S3 as the reference).
- Repo layout:

```
leadpilot/
  apps/ web/  api/  worker/        # worker reuses api modules, runs only queue processors
  packages/ database/ shared-types/ validation/ ai/ ui/ config/
  infrastructure/ docker/ deployment/
  docs/ architecture.md database-schema.md api-specification.md setup-guide.md
        decisions/  legal/  runbooks/  unit-economics.md
  PROGRESS.md  CLAUDE.md
```

## B2. Security architecture

- **Tenant isolation, three layers:** (1) tenant ID derived from authenticated session + validated membership, never from request params/body; (2) tenant-scoped data access layer; (3) PostgreSQL RLS.
- **RLS mechanism:** every request/job runs in a transaction that executes `SET LOCAL app.tenant_id = …` (via Prisma client extension or transaction wrapper). The app connects as a **non-superuser, non-owner DB role** so RLS cannot be bypassed. Migrations use a separate owner role. Platform-admin reads use an explicit, audited bypass path. Document pooling caveats (use transaction-scoped settings only).
- **Background jobs** carry `tenantId` in the payload and re-establish tenant context before touching data. Jobs without tenant context are rejected.
- **Secrets:** integration credentials encrypted with envelope encryption (KMS in prod, local key in dev). Never logged, never returned by APIs after save (show masked + status).
- **Auth:** argon2id hashing, short-lived access tokens, rotating refresh tokens with reuse detection, httpOnly secure cookies, CSRF protection for cookie-authenticated routes, rate limits on auth and public endpoints.
- **Uploads:** allowlist + magic-byte check, size limits, scan, tenant-prefixed keys, access only via short-lived presigned URLs after authorization.
- **Webhooks:** signature verification (Meta, Razorpay), replay protection, idempotent handlers, dedupe table.
- **AI safety:** untrusted-input delimiting, no secrets in prompts, PII minimisation, tool allowlist per tenant, server-side tenant binding for tools, output validation, injection test corpus in CI.
- **Events:** transactional outbox for domain events so automations and notifications are never lost or duplicated.

## B3. Data conventions

- Primary keys: UUIDv7 or ULID. Every tenant-owned table has `tenant_id NOT NULL`, indexed, with RLS policy.
- Timestamps in UTC; user-facing conversion by tenant timezone.
- Soft delete for leads and conversations; hard-delete path for DPDP erasure.
- Money in integer minor units + currency code.
- Phone numbers stored E.164; normalised unique key for dedupe.
- pgvector: HNSW index, embedding model and dimension recorded per chunk so re-embedding is possible.
- Migrations follow expand/contract so deploys are safe.

## B4. Performance budgets

- Dashboard < 2 s at 100k leads/tenant. Inbox and lead lists virtualised. Webhook ACK < 1 s. Customer-visible AI reply p95 < 8 s. Add indexes deliberately; review query plans for analytics.

## B5. Accessibility

- WCAG 2.2 AA. Full keyboard navigation (including Kanban alternative). `prefers-reduced-motion` respected. Visible focus ring.

## B6. Design system

**Direction:** original, premium, calm, information-dense. Reference quality: Linear, Stripe, Attio. Do not copy them.
- Palette via semantic CSS-variable tokens: background, foreground, surface, card, border, muted, primary, secondary, accent, success, warning, danger, focus-ring. Deep navy/graphite foundation, crisp neutral surfaces, one indigo/electric-blue accent, green/amber/red semantic colours. No hardcoded theme colours in components.
- Themes: light, dark, system; persisted; no flash on load (inline pre-hydration script); charts, dialogs, menus, inputs, tooltips all themed; AA contrast.
- Type: Inter or Geist; defined scale for headings, body, labels, table text, tabular numerals, helper text. 4/8 px spacing scale. Restrained radii and subtle elevation.
- **Avoid:** gradient-heavy "AI" look, glassmorphism, glows, emoji icons, oversized empty cards, default-template layouts.
- **Motion:** purposeful and short (≤ 200 ms typical). Required: page transitions, sidebar collapse, nav active indicator, popover/dialog enter/exit, Kanban drag feedback, chart entrance, number count-up, skeletons, toasts, command palette, AI typing indicator, message arrival, status-change feedback, onboarding progress. Layout animation only where it aids comprehension. Reduced-motion fallbacks for all.
- **Signature interactions** (design these deliberately): the lead score ring with explanation popover; the inbox AI↔human mode switch; the pipeline card drag with stage-validation feedback.
- Responsive with distinct mobile experiences for navigation, leads, inbox, appointments, forms and charts (not shrunken desktop).
- **Design the three hero screens first** (Inbox, Lead detail, Pipeline), present them for review, then build the rest.
- Navigation: sidebar (Dashboard, Leads, Inbox, Pipeline, Appointments, AI Assistant, Knowledge Base, Automations, Reports) + Administration (Team, Roles & Permissions, Integrations, Billing, Usage, Audit Logs, Settings). Header: workspace switcher, global search, command palette, quick-create, notifications, theme switcher, profile. Platform admin is a separate surface.

## B7. Industry Packs

A pack is versioned JSON/TS config containing: custom field definitions, pipeline stages, lost reasons, scoring rule defaults, AI prompt templates and qualifying questions, catalog entity mapping, automation template defaults, terminology (e.g. "Site Visit" vs "Consultation"). Real estate is pack #1. Core code must contain no real-estate-specific branching outside the pack.

---

# PART C — PHASE PLAN WITH EXIT GATES

Each phase ends with: (1) all gate checks passing, (2) `PROGRESS.md` updated, (3) docs updated, (4) a short report to the user, (5) **stop**.

## Phase 0 — Plan [no code beyond scaffolding]
- Inspect the repository (currently empty; note this). Produce `docs/architecture.md`, `docs/decisions/0001-…`, a feature checklist in `PROGRESS.md` (every A5 item with tag and status), the pinned version list, the data model outline, and the unit-economics draft.
- **Gate:** user approves the plan.

## Phase 1 — Foundation
- Monorepo, shared config, env validation (Zod), Docker Compose (Postgres+pgvector, Redis, MinIO, ClamAV, Mailpit), CI skeleton.
- Prisma schema for tenants, users, memberships, roles/permissions, audit logs, sessions, outbox. RLS policies + non-owner app role.
- Auth, invitations, tenant creation, RBAC guards, audit logging.
- Design tokens, theme system, app shell, hero-screen designs for review.
- **Gate:** `pnpm lint && pnpm typecheck && pnpm test` green; **cross-tenant isolation test suite passes** (API, direct DB with RLS, job context); auth flows tested incl. refresh reuse; theme works with no flash; seed script creates two demo tenants.

## Phase 2 — CRM
- Leads (all A5 CRM features), activities, notes, attachments, tags, custom fields, assignment, pipeline Kanban, property inventory, Industry Pack loader (real estate), dashboard with real aggregates.
- **Gate:** lead API integration tests including tenant isolation and permission matrix; CSV import/export tested; dashboard numbers verified against seeded fixtures; Kanban keyboard path works; Playwright: create lead → move stage.

## Phase 3 — Communication
- Conversations, messages, inbox UI, SSE real-time, WhatsApp Cloud API integration (sandbox), webhook security/dedupe, 24-hour window enforcement, website widget with origin controls.
- **Gate:** webhook spoofing and replay tests; duplicate delivery test; window-rule tests; widget cross-origin tests; Playwright: widget conversation appears in inbox in real time. **Status line must say "tested against Meta sandbox" or "not yet tested with real provider" truthfully.**

## Phase 4 — AI
- Provider abstraction, orchestrator, tools, knowledge base pipeline, RAG, extraction, scoring, handover, prompt versioning, usage metering and hard caps, **eval harness**.
- **Gate:** eval suite (≥ 30 golden conversations: extraction accuracy, correct tool choice, no hallucinated prices/availability, correct handover); prompt-injection corpus passes; tool-validation and idempotency tests; tenant-isolated retrieval test; LLM-outage fallback test; token usage recorded per call.

## Phase 5 — Automation & appointments
- Appointments with exclusion-constraint double-booking prevention, reminders, outbox, BullMQ workers, eight automation templates, notifications, SLA tracking.
- **Gate:** concurrent-booking test (parallel requests, exactly one wins); automation retry/DLQ tests; timezone/DST reminder tests; Playwright: AI books appointment → reminder job scheduled.
- **MVP milestone:** the A4 vertical slice runs end to end in a scripted demo (`docs/demo-script.md`).

## Phase 6 — SaaS [V1.1]
- Plans, Razorpay subscriptions, GST invoices, plan gating, quotas/alerts, platform admin, Embedded Signup, Google Calendar, public API, remaining V1.1 items.
- **Gate:** Razorpay webhook signature/idempotency tests (test mode); gating enforced at API; downgrade/over-quota behaviour tested.

## Phase 7 — Hardening & launch
- Full E2E suite, security review pass (authz matrix, SSRF, file access, rate limits, sensitive data exposure), load test against budgets, backup/restore drill, runbooks, production deployment guide, SLOs and alerts, legal templates reviewed.
- **Gate:** all critical tests green in CI; restore drill documented; no open high-severity findings.

---

# PART D — AGENT WORKING RULES (MANDATORY)

1. Inspect the repo first. Do not overwrite working code without understanding it.
2. Work on one phase at a time. Never begin the next phase unprompted.
3. Plan before coding; break work into small, independently testable tasks; commit per task with conventional-commit messages on a branch per phase.
4. Strict TypeScript. No `any` (use `unknown` + narrowing). Validate every API input with Zod. Follow DI and module boundaries; modules talk through services/events, not each other's tables.
5. Enforce tenant isolation on every tenant-owned operation, job, file access and retrieval. Write the isolation test **before** the feature.
6. Run lint, typecheck and tests after each meaningful change; fix before moving on. Report failures honestly with output; never mark something done that isn't verified.
7. No placeholder buttons or dead interactions. If something is deferred, it is tagged [V1.1]/[LATER] in `PROGRESS.md` and hidden or disabled in the UI with an explanation.
8. No fake data in production flows. Mocks are allowed only in dev/test and must be clearly labelled (`*.mock.ts`, env-gated). Seed data is dev-only.
9. External services: implement interface, config screen, validation and test mode. Document exactly which credentials are needed. **Never claim an integration works until verified against the real provider (or its official sandbox).**
10. **Ask the user before:** adding a dependency outside B1, changing a schema after its phase gate, anything touching real credentials or billing, destructive operations, or any decision that contradicts Part B.
11. Never commit secrets. Keep `.env.example` complete and documented. Env vars validated at startup.
12. Maintain `PROGRESS.md` (Done / In progress / Pending per A5 item), `docs/decisions/` (one ADR per significant decision), and update docs whenever architecture changes.
13. Maintain `CLAUDE.md` with build/test commands, conventions and gotchas so a fresh session can resume without re-deriving context.
14. If a requirement is ambiguous: document the assumption in an ADR, pick the simplest secure option, continue. Ask only when it blocks implementation.
15. End every session with: what was completed, what is verified vs. unverified, what is next, and any decisions needed from the user.

---

# PART E — DEFINITION OF DONE

**MVP done** when, on a fresh clone with `docker compose up` and the documented setup:

- Users register, verify email, log in; businesses create isolated workspaces; owners invite teammates; roles and permissions are enforced.
- Cross-tenant access is demonstrably impossible via API, DB (RLS) and background jobs (tests prove it).
- Leads can be created, imported, deduplicated, assigned, scored and moved through the pipeline; agents see only what permissions allow.
- WhatsApp (sandbox-verified) and website chat messages arrive in the inbox in real time; human takeover and AI takeover work; the 24-hour window is enforced.
- AI answers from tenant knowledge and database facts, extracts requirements, scores leads, calls only validated tools, never fabricates prices/availability, and hands over correctly; the eval suite and injection corpus pass.
- Appointments book without double booking; reminders fire; automations execute with retries and visible history.
- Dashboard and reports show real tenant data; usage is metered with hard caps.
- Light, dark and system themes work without flash; UI is responsive and keyboard accessible; animations respect reduced motion.
- CI is green; documentation (setup, architecture, API, env vars, runbooks) is complete; `PROGRESS.md` is accurate.

**Launch done** additionally requires Phase 6 and 7 gates.

---

# FIRST INSTRUCTION TO THE AGENT

Execute **Phase 0 only**: inspect the repository, write the architecture document, ADR log, `PROGRESS.md` feature checklist and pinned version list, then stop and report for approval. Do not write application code yet.
