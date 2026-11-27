# Verified Business Rules & Assumptions

*Last analyzed: 2026-11-27*

This document separates **verified business rules** (directly enforced in schema, guards, services, or validation) from **inferred assumptions**.

---

## Verified Business Rules

### 1. Multi-Tenant Isolation & Security
- **RLS Mandatory**: Every tenant-scoped database query MUST execute inside `withTenant(prisma, { tenantId, userId }, fn)` (`packages/database/src/index.ts`).
- **No Client-Supplied Tenant IDs**: `TenantGuard` (`apps/api/src/common/guards.ts`) resolves `tenantId` exclusively from the authenticated session's `activeTenantId` and verifies an `ACTIVE` `Membership` and `ACTIVE` `Tenant`.
- **Workspace MFA Enforcement**: If `tenant.settings.requireMfa === true`, members without enrolled TOTP MFA are blocked (`403 mfa_enrollment_required`) from workspace routes until they enroll on `/security`.
- **Platform Staff Isolation**: `PlatformAdmin`s are stored in `platform_admins` (separate from `users`), use `PLATFORM_JWT_SECRET`, and can only access customer workspaces via time-limited, audited `SupportAccessSession`s (read-only) when explicitly granted by the workspace owner.

### 2. RBAC & Permissions
- **41 Canonical Permissions** (`packages/shared-types/src/permissions.ts`): Scoped as `resource:action[:scope]` where `:own` restricts access to records assigned to the member and `:all` grants workspace-wide access.
- **System Roles**: `owner` (all 41 permissions), `manager` (team-wide CRM, AI/automation, analytics, campaigns, invites), `agent` (`:own`-scoped CRM, inbox reply, appointment write).
- **Per-Member Overrides**: `MemberPermissionOverride` (`GRANT` / `REVOKE`) is resolved on top of role permissions on every request by `resolveEffectivePermissions`.

### 3. CRM, Pipeline & Lead Scoring
- **Pipeline Stage Rules** (`schema.prisma`):
  - A lead counts as "qualified" once at or past a stage with `qualifies = true`.
  - A lead may move to a `WON` stage only from stages with `canCloseWon = true` (prevents skipping the sales process).
  - Moving a lead to a `LOST` stage requires a `LostReason`.
- **Manual Score Override**: Setting a manual score sets `lead.scoreOverridden = true`; automatic rule-based scoring continues recording `LeadScore` history but does not overwrite `lead.score` until the override is cleared.
- **Money Representation**: All monetary values (`budgetMinMinor`, `budgetMaxMinor`, `priceMinor`, `taxableMinor`, `totalMinor`) are stored in minor units (e.g., paise for INR).

### 4. Messaging, AI & Healthcare Safety
- **WhatsApp 24-Hour Window**: `Conversation.lastInboundAt` tracks the 24-hour customer-service window; outside it, free-form replies are blocked and approved `WhatsappTemplate`s are required.
- **Consent Ledger**: `Consent` is append-only; the latest row per `(leadId, channel)` is the effective opt-in/opt-out state.
- **AI Token Cap & Kill Switch**: `AI_KILL_SWITCH=true` globally disables AI replies; `AiAssistant.monthlyTokenCap` caps per-tenant monthly AI token usage.
- **Healthcare Pack Non-Clinical Rule** (`packages/shared-types/src/industry-packs.ts`): For `healthcare`, the AI is strictly prohibited from giving medical advice, diagnoses, treatment suggestions, or recording symptoms/health details, and must immediately call `handover_to_human` on clinical queries.

### 5. Billing, Lifecycle & Retention
- **Read-Only Workspace States** (`apps/api/src/billing/plan.guard.ts`):
  - `EXPIRED` / restricted subscriptions block all non-`GET/HEAD/OPTIONS` mutations (`402 Payment Required`), except `@BillingExempt()` routes.
  - Workspaces with a pending `TenantDeletionRequest` block all mutations (`403 Forbidden`) until the owner cancels deletion.
- **Retention Floor** (`apps/api/src/config/env.ts`): No workspace may configure a data retention period shorter than `RETENTION_MIN_DAYS` (default `7` days).
- **Deletion Cooling-Off**: Workspace deletion requests have a `DELETION_COOLING_OFF_DAYS` (default `14` days) grace period before automated purge.

---

## Inferred Assumptions (Verify with Product/Stakeholders)
- **Primary Market**: Default currency (`INR`), default timezone (`Asia/Kolkata`), GST/GSTIN/SAC invoicing, and Indian property portal parsers (`99acres`, `MagicBricks`, `Housing`) strongly indicate an India-first SMB target market, though timezone and currency are configurable per tenant.
- **Single Pipeline per Tenant**: `schema.prisma` notes "One pipeline per tenant in the MVP"; multi-pipeline support is not currently modeled.
