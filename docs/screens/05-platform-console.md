# 05 — Platform Staff Console & Non-Product Routes

This document covers the internal vendor administration console (`/platform/*`) used by LeadPilot staff, plus a brief reference for system/design routes.

> [!NOTE]
> Platform sessions are strictly isolated from customer workspace sessions (`platformApi` vs `api`).

---

## `/platform/login` — Staff Console Sign In

- **Route & Access**: `/platform/login` (Public staff entry point)
- **What It Does**: Authenticates LeadPilot internal staff with email, password, and mandatory TOTP MFA (or backup recovery code).
- **User Flow**:
  1. Enter staff email and password.
  2. Enter the 6-digit authenticator code (or toggle to backup recovery code).
- **Navigation & Direction**:
  - **Incoming**: Direct URL or unauthenticated redirect from `/platform/*`.
  - **Outgoing**: Success -> `/platform`.
- **Technical Reference**: `apps/web/app/platform/login/page.tsx` · `POST /platform/auth/login`, `POST /platform/auth/mfa`

---

## `/platform` — Executive Overview

- **Route & Access**: `/platform` (Authenticated platform staff)
- **What It Does**: Displays whole-platform health: total workspaces, subscription breakdown (`Active`, `On Trial`, `Past Due`, `Cancelled / Expired`), revenue metrics, and quick links to operational areas.
- **User Flow**:
  1. Review platform-wide KPIs and subscription distribution bars.
  2. Jump to tenant management, plans, or ops health.
- **Navigation & Direction**:
  - **Incoming**: Post-login default for `/platform/login`, or Platform Shell sidebar **Overview**.
  - **Outgoing**: Links to `/platform/tenants`, `/platform/plans`, `/platform/ops`.
- **Technical Reference**: `apps/web/app/platform/page.tsx` · `GET /platform/metrics`

---

## `/platform/tenants` — Workspaces & Tenants Registry

- **Route & Access**: `/platform/tenants` (Authenticated platform staff)
- **What It Does**: Searchable and filterable registry of all customer workspaces with active/suspended summary counts.
- **User Flow**:
  1. Search by workspace name or email, and filter by **Status** (`ACTIVE`, `SUSPENDED`) or **Plan**.
  2. Click any workspace row to open its full management view.
- **Navigation & Direction**:
  - **Incoming**: Platform Shell sidebar **Workspaces & Tenants** or `/platform`.
  - **Outgoing**: Clicking a tenant -> `/platform/tenants/[id]`.
- **Technical Reference**: `apps/web/app/platform/tenants/page.tsx` · `GET /platform/tenants`, `GET /platform/plans`

---

## `/platform/tenants/[id]` — Tenant Detail & Support Actions

- **Route & Access**: `/platform/tenants/[id]` (Authenticated platform staff)
- **What It Does**: Deep-dive view of a single customer workspace showing subscription, usage quotas, members, and invoices, plus staff intervention controls.
- **User Flow**:
  1. Inspect workspace status, plan limits/usage progress bars, and team roster.
  2. **Actions** *(all require a 5+ character audit reason)*:
     - **Suspend** or **Reactivate** workspace.
     - **Assign Plan** (`complimentary` or `trial` with duration in days).
     - **Start Support Access** (`SupportAccessButton`) if the workspace owner granted support access in `/settings`.
- **Navigation & Direction**:
  - **Incoming**: `/platform/tenants` row, or tenant link from `/platform/audit` / `/platform/deletions`.
  - **Outgoing**: Back to `/platform/tenants`; starting a support session opens the customer workspace in support mode.
- **Technical Reference**: `apps/web/app/platform/tenants/[id]/page.tsx` · `GET /platform/tenants/:id`, `POST /platform/tenants/:id/suspend|reactivate|plan`

---

## `/platform/plans` — Subscription Plans & Entitlements

- **Route & Access**: `/platform/plans` (Authenticated platform staff)
- **What It Does**: Creates and edits SaaS subscription plans, pricing (INR), trial days, public visibility, active status, and per-plan feature/limit entitlements.
- **User Flow**:
  1. Click **New Plan** or **Edit** on an existing plan card.
  2. Configure key, name, description, price in ₹, trial days, sort order, visibility (`isPublic`, `active`), and toggle feature flags & numeric limits.
- **Navigation & Direction**:
  - **Incoming**: Platform Shell sidebar **Plans**.
  - **Outgoing**: Published active plans immediately appear on customer `/billing`.
- **Technical Reference**: `apps/web/app/platform/plans/page.tsx` · `GET/POST/PATCH /platform/plans*`

---

## `/platform/ops` — Operations & Infrastructure Health

- **Route & Access**: `/platform/ops` (Authenticated platform staff)
- **What It Does**: Real-time operational dashboard showing firing alerts (with severity, trigger values, and runbook paths), database/Redis/worker health, queue depths, webhook/AI/messaging throughput.
- **User Flow**:
  1. Check firing `AlertCard` banners at the top and follow the linked runbook path (e.g., `docs/runbooks/...`).
  2. Inspect worker heartbeats, queue backlogs, and error rates.
- **Navigation & Direction**:
  - **Incoming**: Platform Shell sidebar **Ops**.
  - **Outgoing**: Terminal monitoring view.
- **Technical Reference**: `apps/web/app/platform/ops/page.tsx` · `GET /platform/ops`

---

## `/platform/health` — Platform Health Summary

- **Route & Access**: `/platform/health` (Authenticated platform staff)
- **What It Does**: One-glance Healthy / Degraded badge combining readiness probes (`/health/ready`) with firing ops alerts, plus outbox backlog.
- **User Flow**: Check the badge; follow **Open Ops Status** to `/platform/ops` for alert detail and runbooks.
- **Navigation & Direction**: **Incoming**: Platform Shell. **Outgoing**: `/platform/ops`.
- **Technical Reference**: `apps/web/app/platform/health/page.tsx` · `GET /health/ready`, `GET /platform/ops`

---

## `/platform/audit` — Platform Audit Log

- **Route & Access**: `/platform/audit` (Authenticated platform staff)
- **What It Does**: Immutable, append-only log of all staff interventions (suspensions, plan overrides, support sessions) and staff logins.
- **User Flow**:
  1. Filter log entries by action, admin email, reason, or workspace ID.
- **Navigation & Direction**:
  - **Incoming**: Platform Shell sidebar **Audit**.
  - **Outgoing**: Links to affected workspaces (`/platform/tenants/[id]`).
- **Technical Reference**: `apps/web/app/platform/audit/page.tsx` · `GET /platform/audit`

---

## `/platform/deletions` — Pending Workspace Deletions

- **Route & Access**: `/platform/deletions` (Authenticated platform staff)
- **What It Does**: Queued list of workspaces marked for GDPR / self-service deletion, showing remaining days in the cooling-off grace period before automated purge.
- **User Flow**:
  1. Monitor requested deletion dates, reasons, and `purgeAfter` countdowns.
  2. Click a workspace to inspect it in `/platform/tenants/[id]`.
- **Navigation & Direction**:
  - **Incoming**: Platform Shell sidebar **Deletions**.
  - **Outgoing**: Links to `/platform/tenants/[id]`.
- **Technical Reference**: `apps/web/app/platform/deletions/page.tsx` · `GET /platform/deletion-requests`

---

## `/platform/security` — Staff MFA & Security

- **Route & Access**: `/platform/security` (Authenticated platform staff)
- **What It Does**: Configures TOTP two-step verification and backup recovery codes for the signed-in platform staff member.
- **User Flow**:
  1. Enroll or manage authenticator-app 2FA via `MfaPanel`.
- **Navigation & Direction**:
  - **Incoming**: Platform Shell sidebar **Security**.
  - **Outgoing**: Terminal account security screen.
- **Technical Reference**: `apps/web/app/platform/security/page.tsx` · `GET/POST /platform/security/mfa*`

---

## Appendix: Non-Product & System Routes

These routes exist in `apps/web/app/` for design previews, error boundaries, or development testing—not end-user workflows:
- `/design/dashboard`, `/design/inbox`, `/design/lead`, `/design/pipeline` (`apps/web/app/design/*/page.tsx`): Static UI mockups with hard-coded sample data.
- `/dev-error` (`apps/web/app/dev-error/page.tsx`): Development-only error boundary trigger (returns `notFound()` in production).
- `not-found.tsx`, `error.tsx`, `global-error.tsx`: Next.js fallback UIs for 404s and unhandled runtime errors.
