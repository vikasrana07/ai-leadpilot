# LeadPilot AI — Progress

Legend: ☐ pending · ◐ in progress · ☑ done (verified) · Tags: **M** = MVP, **V** = V1.1, **L** = Later
Last updated: 2026-11-16 · Current phase: **Phase 0 (awaiting approval)**

## Phase status
| Phase | Status |
|---|---|
| 0 Plan | ◐ documents written, awaiting user approval |
| 1 Foundation | ☐ |
| 2 CRM | ☐ |
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
- ☐ M Tenant model + settings
- ☐ M Onboarding wizard (resumable, 9 steps)
- ☐ M Register / login / logout / verify email / forgot+reset password
- ☐ M Refresh rotation with reuse detection; session list/revoke
- ☐ M Invitation-based signup
- ☐ M Roles + granular permissions, guards
- ☐ M Audit log (append-only)
- ☐ M RLS on all tenant tables + isolation test suite
- ☐ M Design tokens, light/dark/system theme, no-flash
- ☐ M App shell (sidebar, header, command palette, breadcrumbs)
- ☐ M i18n infrastructure
- ☐ V Permission overrides per member · ☐ L Fully custom roles

### CRM (Phase 2)
- ☐ M Lead CRUD, soft delete, search/filter/sort/cursor pagination
- ☐ M CSV import (validation report) / export
- ☐ M Bulk assign / bulk status
- ☐ M Duplicate detection, lead merge + audit
- ☐ M Activity timeline, notes, attachments, tags, custom fields
- ☐ M Lead detail page (all states)
- ☐ M Lead capture API (API key + public form)
- ☐ M Pipeline Kanban (+ keyboard alternative), stage config, history, lost reasons
- ☐ M Property inventory + CSV import
- ☐ M Industry Pack loader (real estate pack)
- ☐ M Dashboard (KPIs, charts, widgets, date filters) from real data
- ☐ M Team management, workload, round-robin option
- ☐ V Portal email parsing · ☐ L Meta Lead Ads · ☐ L Google Sheets

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

## Decisions needed from the user
1. **Approve Phase 0 plan** and the proposed ADRs.
2. **`git init`** in this directory (and a remote?) at start of Phase 1: OK?
3. **TypeScript 6.0.3 and Prisma 7.10.1** instead of the npm `latest` tags (TS 7.0.2, Prisma 8 RC). OK? (ADR-0008)
4. ☑ **WhatsApp billing: tenants pay Meta directly on their own WABA** (decided 2026-11-16). LeadPilot plans price the software only; no WhatsApp resale or margin.
5. **LLM default model** and who holds the API key in dev. The brief only says OpenAI. I need a dev key later; I will not use it until you provide it.
6. **Meta test assets:** do you have a Meta developer account / WhatsApp test number for sandbox verification in Phase 3?
7. **Email provider** for transactional mail (SES, Resend, other). Mailpit is used locally.
8. **Lead = person record in MVP** (no separate contacts table). OK? (ADR-0010)

## Assumptions made (unless you object)
- pnpm + Turborepo; SSE for real-time; AWS ECS/Fargate as the reference deployment.
- Manual WhatsApp token entry for MVP, Embedded Signup in V1.1.
- Brief prices are ex-GST.
- English + Hindi/Hinglish for the AI in MVP.
