# 02 — Product Discovery

Reverse-engineered from code, migrations, nav (`apps/web/lib/nav.ts`), ADRs (`docs/decisions/0001–0012`) and `PROGRESS.md`. Stated intent in `MASTER_PROMPT.md` was cross-checked against implementation, not trusted.

## 1. Vision and problem

**Vision [Inference, from `MASTER_PROMPT.md` and code naming; no README was read]:** never lose a lead to a missed enquiry, slow reply or forgotten follow-up.

**Problem [Inference]:** Indian SMEs (real estate agencies first) capture enquiries from ads, portals, walk-ins and WhatsApp, track them in spreadsheets or personal phones, reply late, and cannot see which leads are hot. Lost enquiries are lost revenue.

**Solution shape [Fact]:** one workspace per business with: capture (WhatsApp, web widget, API, CSV, manual) → AI-assisted qualification and scoring → team inbox with human takeover → pipeline, tasks and automations → appointment booking → reporting; billed per plan via Razorpay with GST invoices.

## 2. Target market

- **Primary:** Indian real-estate agencies and brokers (rupee `Lakh/Crore` parsing in `common/money.ts`, property inventory module, site-visit fields on `Lead`).
- **Secondary (industry packs, ADR 0011):** coaching institutes, clinics, home services. Packs rename vocabulary (Leads/Enquiries/Customers via `navLabel`), toggle modules (`module: 'properties'`), and seed pipelines/templates.
- **Compliance posture [Fact]:** DPDP-oriented export/erasure/retention (`lifecycle/`, `privacy/`, runbook `data-breach-dpdp.md`), Meta data-deletion callbacks, GST invoicing, `docs/legal/`.

## 3. Personas and roles

| Persona | Evidence | What they do |
|---|---|---|
| **Workspace Owner** | system role `owner` (`sync-system-roles.ts`) | Everything: billing, team, roles, integrations, settings |
| **Manager** | system role `manager` (permission list in `permissions.ts`, includes `campaign:read/manage`, `automation:manage`) | Team-wide leads/inbox/reports, assignment, pipeline config, campaigns |
| **Sales Agent** | system role `agent` | Own leads/conversations/appointments; replies, notes, tasks |
| **Custom-role user** | `roles/roles.module.ts`, `role-builder-dialog.tsx` (new) | Tenant-defined permission bundles (41 keys); cannot grant what they do not hold |
| **Platform admin (vendor staff)** | `platform/`, `/platform/*` pages, separate `PLATFORM_JWT_SECRET`, MFA enforced only when `PLATFORM_REQUIRE_MFA=true` (`.env.example` ships `false`) | Tenant lifecycle, plans, ops health, audit, time-boxed read-only support impersonation |
| **Lead / customer** | `portal/` (OTP login, own appointments) | Self-service view of their appointments |
| **Website visitor** | `widget/` | Chat via embeddable widget with Turnstile bot check |
| **External developer** | `v1/`, `api-keys`, `webhooks` | Scoped API keys, signed outbound webhooks |

## 4. Modules (implementation maturity)

Maturity legend: **Full** = code + automated tests + UI present (I did not click through the UI); **Mock-verified** = full but only against mock providers; **Partial** = works for happy path with identified gaps; **Missing**.

| # | Module | Business purpose | Key code | Maturity |
|---|---|---|---|---|
| 1 | Identity & access | Register, login, sessions, verify/reset, invites, MFA | `auth/`, `mfa/`, `common/guards.ts` | Full |
| 2 | Tenancy & workspace | Tenants, settings, onboarding, assignment rules | `tenants/`, `db/` | Full |
| 3 | RBAC & custom roles | Least privilege, role builder | `roles/`, `team/`, `shared-types/permissions.ts` | Full (custom roles: unit-tested only) |
| 4 | CRM | Leads, tags, notes, activity, import/export, merge, duplicates, bulk, custom fields | `leads/` | Full |
| 5 | Pipeline | Stages, lost reasons, board, validated transitions | `pipeline/`, `leads` `checkTransition` | Full |
| 6 | Properties | Inventory for real estate | `properties/` | Full (pack-gated) |
| 7 | Capture | Web widget, API-key lead intake, CSV | `widget/`, `capture/` | Full |
| 8 | Inbox (WhatsApp + web chat) | Unified conversations, takeover/handback, notes, 24h window, STOP handling, SSE live updates | `conversations/`, `channels/`, `realtime/`, `whatsapp/` | Mock-verified |
| 9 | WhatsApp onboarding | Manual + Embedded Signup, template sync | `channels/`, ADR 0012 | Mock-verified |
| 10 | AI assistant | Auto-reply, criteria extraction, scoring, kill-switch, token caps | `ai/` | Mock-verified (LLM provider never run live) |
| 11 | Knowledge base | Upload → ClamAV scan → chunk → embed (pgvector) → retrieve | `ai/knowledge/` | Mock-verified |
| 12 | Appointments | Availability, buffers, slots, exclusion constraint, reminders, portal view | `ops/appointments.service.ts`, `availability.ts` | Full |
| 13 | Google Calendar | Per-user OAuth, free/busy read, one-way event push | `integrations/google-calendar/` | **Partial** (see doc 08/11) |
| 14 | Automations | 8 general templates plus industry-specific ones (`automation-templates.ts`), graph/DAG builder, versions, dry-run, runs/retry | `ops/automation-*.ts`, `graph-executor.ts` | Full |
| 15 | Tasks, notifications, SLA | Follow-ups, alerts, SLA breach marks | `ops/tasks.service.ts`, `sla.service.ts` | Full |
| 16 | **Broadcast campaigns** (new) | WhatsApp template blasts to segmented leads | `campaigns/` | **Partial** — consent, idempotency, quota gaps |
| 17 | **Email tracking** (new) | Send email from a lead, open/click tracking, bounce/complaint suppression | `email-tracking/` | **Partial** — authz, correlation, no unsubscribe |
| 18 | Billing | Plans, entitlements, Razorpay subscription, GST invoices, dunning | `billing/` | Mock-verified |
| 19 | Usage & limits | AI tokens, messaging, storage views; `PlanGuard`/`@RequireFeature` | `ops/usage.module.ts`, `billing/plan.guard.ts` | Full (campaigns not metered) |
| 20 | Public API & webhooks | `/v1` with scopes + idempotency keys; signed outbound webhooks with retries | `v1/`, `webhooks/` | Full |
| 21 | Reports & analytics | Overview, workload, exportable reports | `analytics/`, `reports/` | Full (basic) |
| 22 | Audit | Partitioned audit log, viewer | `audit/` | Full |
| 23 | Privacy & lifecycle | Lead export/erase, retention, workspace export/deletion with grace | `privacy/`, `lifecycle/` | Full |
| 24 | Platform admin | Tenants, plans, ops, support sessions | `platform/`, `support/` | Full |
| 25 | Observability & ops | EMF metrics, alerts, health snapshots, worker heartbeat | `observability/`, `ops/alert*.ts` | Full in code; no deployed monitoring |

## 5. Revenue-generating capabilities [Fact]

- Subscription plans and per-plan entitlements (`Plan`, `PlanEntitlement`, `@RequireFeature(...)` e.g. `ai_assistant`, `web_widget`, `csv_export`, `lead_portal`).
- Razorpay subscribe / change-plan / cancel, proration and dunning (`billing-lifecycle.ts`, `billing-notify.ts`), GST invoices with `InvoiceCounter`.
- AI token caps per tenant (`AI_DEFAULT_MONTHLY_TOKEN_CAP`). Unit-economics model in `docs/unit-economics.md`.
- **Not monetised:** WhatsApp broadcast volume and tracked email volume have no entitlement or metering (grep of `campaigns/` and `billing/` finds none). WhatsApp charges per template conversation, so unmetered campaigns can create direct cost for the vendor or tenant disputes. [Fact on absence; cost impact Inference]

## 6. Core user journeys

1. **Onboard:** register → verify email → onboarding checklist (`/onboarding`, `GET/PUT /tenant/onboarding`) → pick industry pack → connect WhatsApp (embedded signup) → invite team.
2. **Capture → qualify:** WhatsApp inbound webhook (`/webhooks/whatsapp/:key`) → `inbound.service.ts` upserts lead + conversation, records consent, triggers `AiTrigger` → AI replies/extracts criteria/scores → hot lead notifies owner, SLA timer starts.
3. **Human takeover:** agent opens inbox → `takeover` → replies (24h window enforced; template otherwise) → `handback`.
4. **Pipeline & booking:** move stage (validated transitions, lost-reason required) → book appointment from slots (exclusion constraint prevents overlap) → reminders (automation) → optional Google Calendar push.
5. **Automate:** choose template or build a graph → dry-run → enable → runs via outbox/BullMQ with retry and run history.
6. **Broadcast (new):** pick approved template → segment (stage/tag/source/temperature/score) → preview audience & opt-outs → launch or schedule → monitor sent/delivered/read per recipient.
7. **Bill:** plan selection → Razorpay checkout → webhook → printable HTML invoice page (`/invoice/[id]`, login required, print-styled; no PDF generation found).
8. **Operate (platform admin):** tenant search → suspend/plan change → time-boxed support session (needs tenant opt-in via `/support-access`).

## 7. Business rules worth knowing [Fact]

- Stage transitions validated by `checkTransition` (lost reason mandatory, only `lead:write:all` may reopen).
- Agents own what they create; assignment requires `lead:assign` or `lead:write:all` (`leads.service.ts:199-201`).
- Only managers (`lead:write:all`) can merge leads (`:457`).
- WhatsApp STOP keyword → `OPTED_OUT` consent; any later inbound message → `OPTED_IN` (`inbound.service.ts:95-96`).
- Role creation cannot grant permissions the actor lacks (`roles.module.ts`).
- Workspace can require MFA; members without it are blocked from tenant data until enrolled (`TenantGuard`).
- Workspace deletion has a grace period and cancellable request (`TenantDeletionRequest`).

## 8. Unknowns

- Real tenant/customer data, pricing actually charged, and production traffic: none present. [Unverified]
- Whether Meta template approval, Tech-Provider status and business verification are in progress: only documented in `docs/meta-registration/`.
