# 04 — Screen Inventory

Scope: all 51 `page.tsx` routes under `apps/web/app`. Derived from the route tree, `apps/web/lib/nav.ts` (permission per nav item) and the API surface in doc 06.
**Limits:** I did not run the UI. "Status" reflects code presence and test coverage (E2E spec number from `e2e/tests`), not visual QA. Permissions listed are the **nav-level** requirement; real enforcement is server-side (doc 06). A blank permission means nav shows it to every member and the API applies row-level rules.
**How the API/Data/Features columns were built:** from the backend module each screen belongs to plus a grep of the page file's own request paths on 2026-11-23. Sub-components (dialogs, cards, drawers under `components/`) were not traced one by one, so a screen may call more endpoints than listed. Examples where the page file itself differs from the table: `/dashboard` calls `/analytics/overview` and `/tenant/onboarding` but not `/team/workload` directly; `/settings` page code itself calls `/auth/sessions`, `/sla`, `/tenant`, `/tenant/assignment` (privacy, retention, support-access and portal panels live in components); `/reports` also reads `/billing/summary`; `/campaigns/[id]` contains no `refetchInterval`, so live progress is not polled by the page file.

## 1. Workspace app `(app)` — authenticated tenant members

| Screen | Route | Purpose | Intended user | Key features | API consumed | Data | Permission (nav) | Status | Issues / gaps |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard | `/dashboard` | KPIs, hot leads, today's work | All | KPI cards, trends | `/analytics/overview`, `/team/workload` | Lead, Appointment, Task | – | Complete | Authorization for `/team/workload` is enforced in the service (`analytics.module.ts:119`, needs `analytics:read:team`), not by decorator |
| Leads | `/leads` | Search/filter/bulk/import/export | All (row-scoped) | Data table, bulk actions, CSV import/export, saved controls | `/leads*` | Lead, Tag, PipelineStage | – (service: own/all) | Complete | 723-line page; import is synchronous and capped at 5,000 rows |
| Lead detail | `/leads/[id]` | 360° view | All | Timeline, notes, tasks, score+override, stage, send email dialog (new), merge | `/leads/:id*`, `/leads/:id/score`, `/emails/send` | Lead, LeadNote, LeadActivity, LeadScore | – | Complete | Email composer coupled to tracking; no unsubscribe/templates |
| Pipeline | `/pipeline` | Kanban | All | Drag between stages, lost reason | `/pipeline/board`, `/leads/:id/stage` | PipelineStage, Lead | – | Complete | |
| Inbox | `/inbox` | Shared WhatsApp/web chat | Agents, managers | 3-pane, takeover, notes, tags, templates, 24h window, SSE | `/conversations*`, `/realtime/stream`, `/whatsapp/templates` | Conversation, Message, Consent | `conversation:read:own` | Complete (mock providers) | No saved views/bulk actions [Inference] |
| Email Tracking (new) | `/emails` | Sent emails + engagement | Anyone with `lead:read:own` | List, stats, suppression list add/remove | `/emails*` | TrackedEmail, EmailEngagementEvent, EmailSuppression | `lead:read:own` | Partial | **Shows tenant-wide mail to own-scope users; own-scope users can edit suppressions** (doc 08 S-05). 513-line page |
| Broadcasts (new) | `/campaigns` | Campaign list/create | Marketing/managers | Create dialog (segment, template, params, schedule), audience preview | `/campaigns*`, `/whatsapp/templates` | BroadcastCampaign, WhatsappTemplate | `campaign:read` | Partial | No cost estimate, no opt-in warning, no plan gate |
| Campaign detail | `/campaigns/[id]` | Progress & recipients | same | Counters, recipient table by status, cancel | `/campaigns/:id`, `/recipients` | BroadcastRecipient | `campaign:read` | Partial | No `refetchInterval` in the page file (progress may not auto-update); no retry-failed action |
| Properties | `/properties` | Inventory | Real-estate packs | CRUD, CSV import | `/properties*` | Property | `property:read` (pack-gated) | Complete | Hidden unless pack enables |
| Appointments | `/appointments` | Calendar/list, availability | All | Slots, book/reschedule/confirm/no-show, availability + exceptions, preferences | `/appointments*` | Appointment, AvailabilityRule | – | Complete | Google Calendar status is on Integrations, not here; sync failures invisible |
| AI Assistant | `/ai-assistant` | Configure persona/qualification | Owner/manager | Config, scoring rules, usage, runs | `/ai/*`, `/scoring/rules` | AiAssistant, AiRun, ScoringRuleSet | `ai:configure` | Complete (mock LLM) | |
| Knowledge | `/knowledge` | Documents for AI | Owner/manager | Upload, status, reprocess, search, download | `/knowledge/*` | KnowledgeDocument, KnowledgeChunk | `knowledge:manage` | Complete | |
| Tasks | `/tasks` | To-dos | All | Filters, drawer, assign | `/tasks*` (declared in `ops2.controller.ts`) | Task | – | Complete | 799-line page — largest in repo |
| Automations | `/automations` | List/templates/runs | Owner/manager | Enable, runs, retry, templates | `/automations*` | Automation, AutomationRun | `automation:manage` + plan feature `automations` (class-level, `ops2.controller.ts:20`) | Complete | Nav shows the item to everyone; non-permitted users get 403 on load |
| Automation new/edit | `/automations/new`, `/automations/[id]/edit` | Graph/outline builder | same | `@xyflow/react` canvas, validation, dry-run, versions | `/automations/validate`, `/dry-run`, `/versions` | Automation, AutomationVersion | – | Complete | |
| Reports | `/reports` | Analytics | Managers | Keyed reports, CSV export | `/reports/:key*` | multiple | `analytics:read:own` | Complete (basic) | No custom reports/scheduling |
| Team | `/team` | Members & invites | Owner/manager | Invite, role, status, MFA reset | `/team/*` | Membership, Invitation | `team:read` | Complete | |
| Roles | `/roles` | RBAC | Owner | Role builder dialog (new), permission matrix | `/roles*` | Role, RolePermission | `team:read` (page), `role:manage` (mutations) | Complete | Unit-tested only |
| Integrations | `/integrations` | Channels & connectors | Owner | WhatsApp card (embedded signup), widget, SES card, Google Calendar card | `/channels*`, `/widget-config`, `/integrations/google-calendar*` | Channel, WidgetConfig, GoogleCalendarSync | `integration:manage` | Partial | Google Calendar endpoints themselves have no permission check |
| API keys | `/api-keys` | Developer keys | Owner | Create/revoke, scopes | `/api-keys*` | ApiKey | `integration:manage` | Complete | |
| Webhooks | `/webhooks` | Outbound events | Owner | Endpoints, deliveries, redeliver, rotate secret | `/webhooks/*` | WebhookEndpoint, WebhookDelivery | `integration:manage` | Complete | |
| Billing | `/billing` | Plan/invoices | Owner | Subscribe/change/cancel, GST profile | `/billing*` | Subscription, Invoice | `billing:manage` | Complete (mock Razorpay) | |
| Usage | `/usage` | Consumption | Owner | AI/messages/storage | `/usage` | Plan entitlements | `usage:read` | Complete | Campaign/email volume not shown |
| Audit | `/audit` | Trail | Owner | Filter/browse | `/audit-logs` | AuditLog | `audit:read` | Complete | No export |
| Security | `/security` | Own MFA | All | Enrol/disable, recovery codes | `/security/mfa*` | MfaCredential | – | Complete | |
| Settings | `/settings` | Workspace, privacy, support access, retention, portal, assignment | Owner | multiple panels | `/tenant*`, `/privacy*`, `/support-access`, `/portal` | Tenant, PortalConfig | `settings:manage` | Complete | Several concerns in one screen |
| Onboarding | `/onboarding` | Checklist | Owner | Steps incl. Google Calendar | `/tenant/onboarding` | Tenant.settings | – | Complete | |

## 2. Auth and public

| Screen | Route | Purpose | Status | Notes |
|---|---|---|---|---|
| Landing | `/` | Marketing/redirect | Complete | |
| Login / Register | `/login`, `/register` | Auth with Turnstile | Complete | e2e 01 |
| Verify / Forgot / Reset / Accept invite | `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite` | Account flows | Complete | |
| Data deletion | `/data-deletion` | Meta-required status page for data-deletion callbacks | Complete | Public by design |
| Invoice | `/invoice/[id]` | Printable GST invoice | Complete | Verify authorization on fetch (`GET /billing/invoices/:id` requires `billing:manage`) |

## 3. Platform console (`/platform/*`) — vendor staff

| Screen | Route | Purpose | Status |
|---|---|---|---|
| Login | `/platform/login` | Separate admin auth with MFA | Complete |
| Overview | `/platform` | Metrics | Complete |
| Tenants / detail | `/platform/tenants`, `/platform/tenants/[id]` | Suspend, reactivate, plan change, start support session | Complete |
| Plans | `/platform/plans` | Plan/entitlement CRUD | Complete |
| Ops | `/platform/ops` | Queue/worker/alert health | Complete |
| Audit / Deletions / Security | `/platform/audit`, `/deletions`, `/security` | Staff audit, deletion queue, own MFA | Complete |

## 4. Non-product routes

| Route | What it is | Issue |
|---|---|---|
| `/design/dashboard`, `/design/inbox`, `/design/lead`, `/design/pipeline` | Static visual mock-ups with hard-coded KPI/lead data (`app/design/**`) | **UI-only** and served in production builds. Remove or gate. Low risk, confusing in sitemap/crawl. |
| `/dev-error` | Dev-only error demo; `notFound()` in production | Fine |

## 5. Cross-cutting UX assessment

| Concern | Finding | Evidence |
|---|---|---|
| Information architecture | Nav is clear (Workspace vs Admin groups, industry-aware labels). "Email Tracking" and "Broadcasts" are siblings of Inbox but are outbound tools; "Roles" duplicates the permission needed for "Team". | `nav.ts` |
| Build-phase scaffolding | `CURRENT_PHASE`, `phase`, "Soon" state remain in product code | `nav.ts` |
| Consistency | Shared `components/ui`, `data-table`, `page` primitives; a design system exists | `apps/web/components/ui`, `data-table` |
| Accessibility | Dedicated axe E2E (`10-a11y.spec.ts`) and keyboard E2E (`08-keyboard.spec.ts`); `docs/accessibility-and-responsive.md` | e2e |
| Responsive | Mobile E2E (`11-mobile.spec.ts`) | e2e |
| Error handling | Shared `error-view`, request-id surfaced, error-page E2E 16 | `components/error-view.tsx` |
| Form validation | `react-hook-form` + Zod from `@leadpilot/validation` in most dialogs | web deps |
| Loading/empty states | Present in reviewed components; not audited screen by screen | **[Unverified]** |
| Component size | `tasks/page.tsx` 799, `leads/page.tsx` 723, `appointments/page.tsx` 575, `emails/page.tsx` 513, `webhooks/page.tsx` 511 lines; page-level components mix data fetching, state and layout | `wc -l` |
| API layer | 65 files import hand-written `lib/api`; 2 use `lib/api-generated` | grep |
| Duplicate/redundant flows | Opt-out/consent appears in Inbox and in Campaign audience preview but there is no single consent screen; Email suppressions live under Email Tracking, WhatsApp opt-outs under lead consent | code |
