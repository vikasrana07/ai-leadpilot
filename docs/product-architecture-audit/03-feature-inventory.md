# 03 — Feature Inventory

Status key: **✅ Complete** (code + automated tests) · **🧪 Mock-only** (complete, provider never run live) · **◐ Partial** · **UI-only** · **❌ Missing**.
"Tests" lists the nearest suite in `apps/api/test` or `e2e/tests`; it shows coverage exists, not that it is sufficient.

## A. Existing features

| Area | Feature | Status | Evidence / Tests | Notes |
|---|---|---|---|---|
| Auth | Register, login, refresh rotation, logout, sessions list/revoke | ✅ | `auth/`, `auth.test.ts`, e2e 01 | |
| Auth | Email verify, forgot/reset password | ✅ | `auth.controller.ts` | SMTP never run live |
| Auth | TOTP MFA + recovery codes, workspace-enforced MFA, owner MFA reset | ✅ | `mfa/`, `mfa.test.ts`, e2e 09 | |
| Auth | Turnstile bot protection | 🧪 | `security/turnstile.ts`, `bot-protection.test.ts` | |
| Auth | SSO / SAML / OIDC login, SCIM | ❌ | none found | Enterprise gap |
| Team | Invite, role change, deactivate, MFA reset | ✅ | `team/`, `tenancy.test.ts` | |
| RBAC | 3 system roles + custom role builder, 41 permissions, anti-escalation | ✅/◐ | `roles/`, `roles-custom-unit.test.ts`, `security-matrix.test.ts` | Custom roles lack HTTP integration test |
| CRM | Lead CRUD, tags, notes, activity timeline, custom fields | ✅ | `leads/`, `leads.test.ts`, `crm-extras.test.ts` | |
| CRM | CSV import (Lakh/Crore), export (plan-gated), duplicate check, merge, bulk | ✅ | `leads.controller.ts` | Import is synchronous and capped at 5,000 rows; export capped at 50,000 (doc 09 P6) |
| CRM | Row-level scoping own/all | ✅ | `leads.service.ts:24-33` | |
| Pipeline | Stages CRUD/reorder, board, lost reasons | ✅ | `pipeline/` | |
| Properties | CRUD + import | ✅ | `properties/` | pack-gated |
| Capture | Web widget + Turnstile + origin allow-list | ✅ | `widget/`, e2e 03 | |
| Capture | API-key lead intake | ✅ | `POST /api-keys/leads`, `public-api.test.ts` | |
| Inbox | Conversations, messages, retry, notes, tags, assign, close/reopen, media proxy | 🧪 | `conversations/`, `communication.test.ts` | |
| Inbox | Takeover / handback AI↔human | ✅ | `conversations.controller.ts` | |
| Inbox | Realtime (SSE) | ✅ | `realtime/`, `realtime-multi.test.ts` | |
| WhatsApp | Manual connect, Embedded Signup, template sync/create, health | 🧪 | `channels/`, `embedded-signup.test.ts`, `template-sync.test.ts` | |
| AI | Assistant config, kill-switch, token caps, runs log | 🧪 | `ai/`, `ai-*.test.ts`, `eval/` | Eval harness exists; live eval never run |
| AI | Scoring rules + manual override | ✅ | `ai.module.ts`, `ai-pure.test.ts` | |
| AI | Knowledge base (scan → embed → search) | 🧪 | `ai/knowledge/` | ClamAV in CI compose |
| Appointments | Availability, exceptions, slots, CRUD, state machine, reminders, notifications | ✅ | `ops/`, `appointments.test.ts`, `appointments-exclusion-unit.test.ts` | |
| Appointments | Google Calendar: connect, free/busy, push create/patch/delete | ◐ (mock-only; live path likely broken) | `google-calendar.service.ts` | one-way; errors swallowed; OAuth state unchecked; **no access-token refresh** (no `refresh_token` grant, tokens expire ~1 h) and `getDecryptedTokens` (L411) reads RLS-protected `integration_credentials` through `db.prisma` **without tenant context**, so live pushes probably throw and are swallowed (doc 08 S-19) |
| Automation | 8 general templates + industry-specific ones, graph builder, versions, dry-run, runs, retry | ✅ | `automation*.test.ts`, e2e 12/14 | |
| Tasks / SLA / notifications | CRUD, SLA breach, per-user alert settings | ✅ | `tasks.service.ts`, e2e 19 | |
| **Campaigns** | Draft/schedule/launch/cancel, segment preview, per-recipient status, delivery receipts | ◐ | `campaigns-unit.test.ts` (unit only) | No consent check beyond opt-out; non-idempotent; no quota; no HTTP-level test |
| **Email tracking** | Send tracked email, pixel, click redirect, SNS bounce/complaint, suppression list | ◐ | `email-tracking.test.ts`, `ses-sns-validator.test.ts` | Over-broad read scope; SES id correlation unproven; no unsubscribe header found |
| Billing | Plans, subscribe/change/cancel, invoices, webhooks, dunning, grace | 🧪 | `billing*.test.ts`, e2e 04 | |
| Billing | Mock simulator (dev only) | ✅ | `POST /billing/mock/simulate` | runtime-guarded |
| Public API | `/v1` leads/conversations/appointments, scopes, idempotency, rate limit | ✅ | `public-api.test.ts` | no pagination standard documented |
| Webhooks | Endpoints, signed delivery, retries, redeliver, auto-disable | ✅ | `webhooks-outbound.test.ts`, `webhook-recovery.test.ts` | |
| Reports | Overview + keyed reports + CSV | ✅ | `reports.test.ts` | |
| Audit | Partitioned log + viewer | ✅ | `audit/` | no export, no tamper-evidence |
| Privacy | Lead export/erase, retention, tenant export/deletion | ✅ | `data-lifecycle.test.ts`, e2e 15 | |
| Portal | OTP login for leads | ✅ | `portal*.test.ts` | |
| Platform | Tenants, plans, ops dashboard, audit, support sessions, deletions | ✅ | `platform.test.ts`, `support-access.test.ts`, e2e 06 | |
| Observability | JSON logs, EMF metrics, alerts, health, heartbeat | ✅ | `observability.test.ts`, `alerts.test.ts` | |

## B. Gaps inside existing modules

| Module | Missing capability | Evidence of absence |
|---|---|---|
| Campaigns | Opt-in requirement, consent source/ledger, quotas, plan gate, metering, throttling by Meta tier, A/B, retry of failed recipients, reply attribution, per-campaign cost | `campaigns.service.ts` has no such code; no `@RequireFeature` on `campaigns.controller.ts` |
| Email | List-Unsubscribe / unsubscribe page, templates/sequences, inbound reply capture, domain auth guidance in-app | no matches in `email-tracking/` |
| Google Calendar | Two-way sync (Google→app), webhook/channel renewal (`channelId`, `syncToken` columns exist but unused), token refresh itself (never implemented), failure surfacing | model fields exist; no watch/list calls and no `grant_type: 'refresh_token'` in service |
| Inbox | Saved views/filters, bulk actions, canned-response library UI beyond templates, internal @mentions | not found [Inference from route/API list] |
| CRM | Duplicate auto-merge rules, activity logging of calls/emails from external dialers, lead assignment by territory/skill beyond simple rules | `tenants/assignment` only |
| Reports | Scheduled email reports, custom report builder, cohort/funnel visualisation | `reports/:key` fixed keys |
| Billing | Usage-based add-ons (messages), tax-exempt handling, credit notes | grep of `billing/` for credit-note/tax-exempt/reverse-charge: no matches |
| Admin | Impersonation is read-only (by design); no bulk tenant ops | `support/` |

## C. Planned/scaffolding visible in code

- `CURRENT_PHASE = 6` and `phase` on every nav item with a "Soon" state: build-time scaffolding, now dead logic (`nav.ts`).
- `/design/*` pages: static visual mock-ups with hard-coded data (`apps/web/app/design/**`). **UI-only.**
