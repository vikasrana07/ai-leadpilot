# API Architecture & Endpoint Specification: LeadPilot AI

## 1. API Architecture Overview

The LeadPilot backend API (`apps/api`) is built on **NestJS 12**, serving **265 distinct HTTP endpoints** across 213 paths. It is structured into three distinct authentication and lifecycle zones:

1. **Tenant Web Application API** (`/*`): Cookie-authenticated JSON API consumed by the Next.js single-page application.
2. **Public Developer & Integration API** (`/v1/*`): Scoped Bearer API-key authenticated REST API designed for CRM integrations and external automation tools.
3. **Platform Super-Admin API** (`/platform/*`): Segregated administrative control plane authenticated via independent platform JWT sessions.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LEADPILOT API SURFACE                           │
├──────────────────────┬──────────────────────┬──────────────────────────┤
│ Tenant App API (/*)  │ Public API (/v1/*)   │ Platform API (/platform) │
├──────────────────────┼──────────────────────┼──────────────────────────┤
│ • Auth: HttpOnly JWT │ • Auth: API Key      │ • Auth: Platform JWT     │
│ • Tenant Context RLS │ • Scoped Permissions │ • Segregated Database    │
│ • 32 RBAC Permissions│ • Idempotency Keys   │   Super-Admin Context    │
│ • Orval Client Hooks │ • Swagger OpenAPI    │ • System Observability   │
└──────────────────────┴──────────────────────┴──────────────────────────┘
```

---

## 2. API Design Conventions & Protocols

### A. Request & Response Contracts
- **Serialization**: Standard JSON payloads. Requests and responses use strict camelCase property naming.
- **Validation**: All incoming mutation requests pass through NestJS `ZodValidationPipe` (`apps/api/src/common/zod.pipe.ts`), validating payloads against shared Zod schemas before entering service logic.
- **Error Envelopes**: Errors adhere to a unified JSON error schema:
  ```json
  {
    "error": {
      "code": "invalid_input",
      "message": "Validation failed",
      "details": [{ "path": "phone", "message": "Invalid Indian phone number format" }],
      "requestId": "req_01h8x..."
    }
  }
  ```
- **HTTP Status Codes**:
  - `200 OK` / `201 Created` for successful mutations.
  - `204 No Content` for successful deletions.
  - `400 Bad Request` for schema/input validation errors.
  - `401 Unauthorized` for missing/expired session tokens.
  - `402 Payment Required` for plan entitlement exhaustion.
  - `403 Forbidden` for RBAC permission violations.
  - `404 Not Found` for nonexistent resources or cross-tenant access attempts.
  - `409 Conflict` for duplicate bookings or concurrency collisions.
  - `422 Unprocessable Entity` for domain validation failures (e.g., invalid stage transitions).
  - `429 Too Many Requests` for rate-limit breaches.

### B. Authentication & Session Management
- **HttpOnly Cookies**: Access tokens are stored in secure, HttpOnly, SameSite=Lax cookies, mitigating cross-site scripting (XSS) token theft.
- **Token Rotation & Session Invalidation**: Refresh tokens rotate on every invocation. Replay detection automatically invalidates all descendant sessions if an old refresh token is reused.
- **Workspace Resolution**: `TenantGuard` resolves the active workspace through the session claim or the `X-Workspace` header. Crucially, the header is treated only as a hint to select among the user's verified memberships; it can never bypass membership validation.

### C. Rate Limiting & Abuse Prevention
- **Redis-Backed Throttler**: Integrated with `@nestjs/throttler` and `ioredis` (`apps/api/src/common/redis-throttler.ts`). Counters are shared across horizontal API instances, falling back gracefully to in-memory tracking if Redis is unreachable.
- **Tiered Rate Limits**:
  - Unauthenticated endpoints (`/auth/login`, `/auth/register`): 10 requests / minute / IP.
  - Tenant Web App: 300 requests / minute / IP.
  - Public Developer API (`/v1`): Configurable 120 requests / minute / API key.
  - Customer Portal Login: 5 attempts / minute / IP.

### D. Idempotency & Concurrency Control
- **Idempotency Interceptor**: Mutation endpoints on the `/v1` public API support an `Idempotency-Key` header. Requests are tracked in the `idempotency_keys` table. Duplicate submissions within 24 hours replay the cached response without re-executing business logic.

---

## 3. Comprehensive API Inventory (By Domain)

### Group 1: Identity, Authentication & Team (32 Endpoints)
| Method | Path | Summary / Operation | Auth | Permissions | Database Entities |
|---|---|---|---|---|---|
| `POST` | `/auth/register` | Create user and workspace | Public + Bot Guard | None | `User`, `Tenant`, `Membership` |
| `POST` | `/auth/login` | Authenticate with email/password | Public + Bot Guard | None | `User`, `Session` |
| `POST` | `/auth/mfa/verify` | Verify TOTP challenge | Public + Challenge | None | `User`, `MfaCredential` |
| `POST` | `/auth/refresh` | Refresh access session | Refresh Cookie | None | `User`, `Session` |
| `POST` | `/auth/logout` | Revoke session | Authenticated | None | `Session` |
| `GET` | `/auth/me` | Fetch active user context | Authenticated | None | `User`, `Membership`, `Role` |
| `POST` | `/auth/switch-workspace` | Switch active tenant context | Authenticated | None | `Membership` |
| `POST` | `/auth/verify-email` | Verify email address | Public (Token) | None | `EmailVerificationToken` |
| `POST` | `/auth/forgot-password` | Request password reset | Public + Bot Guard | None | `PasswordResetToken` |
| `POST` | `/auth/reset-password` | Reset password using token | Public | None | `User`, `PasswordResetToken` |
| `GET` | `/auth/sessions` | List active user sessions | Authenticated | None | `Session` |
| `DELETE` | `/auth/sessions/{id}` | Revoke specific session | Authenticated | None | `Session` |
| `POST` | `/auth/invitations/preview` | Inspect invite details | Public (Token) | None | `Invitation` |
| `POST` | `/auth/invitations/accept` | Accept workspace invitation | Public (Token) | None | `Invitation`, `Membership` |
| `GET` | `/security/mfa` | Get MFA enrollment status | Authenticated | None | `MfaCredential` |
| `POST` | `/security/mfa/enroll` | Initialize TOTP enrollment | Authenticated | None | `MfaCredential` |
| `POST` | `/security/mfa/confirm` | Confirm TOTP with code | Authenticated | None | `MfaCredential`, `MfaRecoveryCode` |
| `POST` | `/security/mfa/recovery-codes` | Regenerate recovery codes | Authenticated | None | `MfaRecoveryCode` |
| `POST` | `/security/mfa/disable` | Disable 2FA | Authenticated | None | `MfaCredential` |
| `GET` | `/security/workspace` | View workspace 2FA policy | Authenticated | `settings:manage` | `Tenant` |
| `PUT` | `/security/workspace` | Enforce workspace-wide 2FA | Authenticated | `settings:manage` | `Tenant` |
| `GET` | `/team/members` | List workspace members | Authenticated | `team:read` | `Membership`, `User`, `Role` |
| `GET` | `/team/invitations` | List pending invitations | Authenticated | `team:read` | `Invitation` |
| `POST` | `/team/invitations` | Invite new team member | Authenticated | `team:invite` | `Invitation` |
| `DELETE` | `/team/invitations/{id}` | Revoke invitation | Authenticated | `team:invite` | `Invitation` |
| `PATCH` | `/team/members/{id}/role` | Change member role | Authenticated | `team:manage` | `Membership`, `Role` |
| `PATCH` | `/team/members/{id}/status` | Activate/deactivate member | Authenticated | `team:manage` | `Membership` |
| `POST` | `/team/members/{id}/mfa-reset` | Admin reset member MFA | Authenticated | `team:manage` | `MfaCredential` |
| `GET` | `/roles` | List all system roles | Authenticated | None | `Role`, `Permission` |
| `GET` | `/audit-logs` | Retrieve audit history | Authenticated | `audit:read` | `AuditLog` |
| `GET` | `/tenant` | Get workspace profile | Authenticated | `settings:manage` | `Tenant` |
| `PATCH` | `/tenant` | Update workspace profile | Authenticated | `settings:manage` | `Tenant` |

### Group 2: CRM Core & Pipelines (28 Endpoints)
| Method | Path | Summary / Operation | Auth | Permissions | Database Entities |
|---|---|---|---|---|---|
| `GET` | `/leads` | List leads (paginated/filtered) | Authenticated | `lead:read:own` / `all` | `Lead`, `Tag`, `LeadTag` |
| `POST` | `/leads` | Create new lead manually | Authenticated | `lead:write:own` / `all`| `Lead`, `LeadActivity` |
| `GET` | `/leads/meta` | Get lead filter metadata | Authenticated | `lead:read:own` / `all` | `PipelineStage`, `LeadSource` |
| `GET` | `/leads/tags` | List all lead tags | Authenticated | `lead:read:own` / `all` | `Tag` |
| `POST` | `/leads/check-duplicates` | Duplicate checking | Authenticated | `lead:write:own` / `all`| `Lead` |
| `POST` | `/leads/bulk` | Bulk stage/assign/tag/delete | Authenticated | `lead:write:all` | `Lead`, `LeadActivity` |
| `POST` | `/leads/import` | Two-step CSV lead import | Authenticated | `lead:import` | `Lead`, `AuditLog` |
| `GET` | `/leads/export` | Export leads to CSV | Authenticated | `lead:export` | `Lead` |
| `GET` | `/leads/{id}` | Get lead detail view | Authenticated | `lead:read:own` / `all` | `Lead`, `LeadScore`, `CustomField` |
| `PATCH` | `/leads/{id}` | Update lead fields | Authenticated | `lead:write:own` / `all`| `Lead`, `LeadActivity` |
| `DELETE` | `/leads/{id}` | Soft delete lead | Authenticated | `lead:delete` | `Lead` |
| `POST` | `/leads/{id}/stage` | Advance pipeline stage | Authenticated | `lead:write:own` / `all`| `Lead`, `StageTransition` |
| `PUT` | `/leads/{id}/tags` | Replace lead tags | Authenticated | `lead:write:own` / `all`| `LeadTag` |
| `GET` | `/leads/{id}/notes` | Get internal notes | Authenticated | `lead:read:own` / `all` | `LeadNote` |
| `POST` | `/leads/{id}/notes` | Create lead note | Authenticated | `lead:write:own` / `all`| `LeadNote`, `LeadActivity` |
| `GET` | `/leads/{id}/activity` | Fetch activity timeline | Authenticated | `lead:read:own` / `all` | `LeadActivity` |
| `POST` | `/leads/{id}/merge` | Merge duplicate lead | Authenticated | `lead:write:all` | `Lead`, `LeadActivity` |
| `POST` | `/leads/{id}/score/override`| Manually override score | Authenticated | `lead:score:override` | `LeadScore`, `Lead` |
| `GET` | `/pipeline/stages` | List pipeline stages | Authenticated | `lead:read:own` / `all` | `PipelineStage` |
| `POST` | `/pipeline/stages` | Create custom stage | Authenticated | `pipeline:manage` | `PipelineStage` |
| `GET` | `/pipeline/board` | Get Kanban board view | Authenticated | `lead:read:own` / `all` | `PipelineStage`, `Lead` |
| `POST` | `/pipeline/stages/reorder`| Reorder stages | Authenticated | `pipeline:manage` | `PipelineStage` |
| `PATCH` | `/pipeline/stages/{id}` | Update stage properties | Authenticated | `pipeline:manage` | `PipelineStage` |
| `DELETE` | `/pipeline/stages/{id}` | Remove pipeline stage | Authenticated | `pipeline:manage` | `PipelineStage` |
| `POST` | `/pipeline/lost-reasons` | Add lost reason | Authenticated | `pipeline:manage` | `LostReason` |
| `GET` | `/properties` | List inventory units | Authenticated | `property:read` | `Property` |
| `POST` | `/properties` | Create inventory item | Authenticated | `property:manage` | `Property` |
| `POST` | `/properties/import` | CSV import inventory | Authenticated | `property:manage` | `Property` |

### Group 3: Communications & Real-Time (22 Endpoints)
| Method | Path | Summary / Operation | Auth | Permissions | Database Entities |
|---|---|---|---|---|---|
| `GET` | `/channels` | List connected channels | Authenticated | `integration:manage` | `Channel` |
| `POST` | `/channels/whatsapp` | Connect WhatsApp credentials | Authenticated | `integration:manage` | `Channel`, `Credential` |
| `POST` | `/channels/{id}/test` | Send test WhatsApp ping | Authenticated | `integration:manage` | `Channel` |
| `DELETE` | `/channels/{id}` | Disconnect channel | Authenticated | `integration:manage` | `Channel` |
| `GET` | `/whatsapp/templates` | List registered templates | Authenticated | `integration:manage` | `WhatsappTemplate` |
| `POST` | `/whatsapp/templates/sync` | Sync templates with Meta | Authenticated | `integration:manage` | `WhatsappTemplate` |
| `GET` | `/conversations` | List conversation threads | Authenticated | `conversation:read:own`/`all`| `Conversation`, `Lead` |
| `GET` | `/conversations/{id}` | Get conversation metadata | Authenticated | `conversation:read:own`/`all`| `Conversation` |
| `GET` | `/conversations/{id}/messages`| Fetch chat history | Authenticated | `conversation:read:own`/`all`| `Message` |
| `POST` | `/conversations/{id}/messages`| Send outbound reply | Authenticated | `conversation:reply` | `Message`, `OutboxEvent` |
| `POST` | `/conversations/{id}/takeover`| Agent human takeover | Authenticated | `conversation:reply` | `Conversation` |
| `POST` | `/conversations/{id}/assign` | Reassign conversation | Authenticated | `conversation:assign` | `Conversation` |
| `POST` | `/conversations/{id}/close` | Close conversation thread | Authenticated | `conversation:reply` | `Conversation` |
| `GET` | `/realtime/stream` | Server-Sent Events stream | Authenticated | Valid Session | Redis Pub/Sub |
| `GET` | `/webhooks/whatsapp/:key` | Meta webhook verify challenge| Public | None (Meta Token) | None |
| `POST` | `/webhooks/whatsapp/:key` | Inbound WhatsApp webhook | Public | HMAC-SHA256 Signature| `WebhookEvent`, `Message` |
| `GET` | `/widget-config` | Get chat widget settings | Authenticated | `integration:manage` | `WidgetConfig` |
| `PUT` | `/widget-config` | Update widget branding/rules| Authenticated | `integration:manage` | `WidgetConfig` |
| `GET` | `/widget.js` | Embeddable JS asset | Public | None (Strict CSP) | None |

### Group 4: Operations, AI, Scheduling & Automations (24 Endpoints)
| Method | Path | Summary / Operation | Auth | Permissions | Database Entities |
|---|---|---|---|---|---|
| `GET` | `/appointments` | List appointments calendar | Authenticated | `appointment:read:own`/`all`| `Appointment`, `Lead` |
| `POST` | `/appointments` | Book new consultation | Authenticated | `appointment:write` | `Appointment`, `OutboxEvent` |
| `PATCH` | `/appointments/{id}` | Reschedule / cancel | Authenticated | `appointment:write` | `Appointment` |
| `GET` | `/appointments/slots` | Query available rep slots | Authenticated | `appointment:write` | `AvailabilityRule` |
| `GET` | `/automations` | List active workflows | Authenticated | `automation:manage` | `Automation`, `AutomationRun` |
| `POST` | `/automations` | Create workflow (template/DAG)| Authenticated | `automation:manage` | `Automation`, `AutomationVersion`|
| `GET` | `/automations/{id}` | Fetch workflow graph | Authenticated | `automation:manage` | `AutomationVersion` |
| `PUT` | `/automations/{id}` | Save updated graph version | Authenticated | `automation:manage` | `AutomationVersion` |
| `GET` | `/automations/{id}/runs` | Fetch run execution logs | Authenticated | `automation:manage` | `AutomationRun` |
| `GET` | `/tasks` | List rep tasks and due items | Authenticated | Authenticated member | `Task`, `Lead` |
| `PATCH` | `/tasks/{id}` | Complete or update task | Authenticated | Authenticated member | `Task` |
| `GET` | `/ai-assistant` | Get AI configuration | Authenticated | `ai:configure` | `AiAssistant` |
| `PUT` | `/ai-assistant` | Update AI prompt / tools | Authenticated | `ai:configure` | `AiAssistant` |
| `GET` | `/knowledge` | List uploaded documents | Authenticated | `knowledge:manage` | `KnowledgeDocument` |
| `POST` | `/knowledge/upload` | Upload PDF/DOCX brochure | Authenticated | `knowledge:manage` | `KnowledgeDocument`, `Chunk` |
| `DELETE` | `/knowledge/{id}` | Purge document & chunks | Authenticated | `knowledge:manage` | `KnowledgeDocument` |
| `GET` | `/sla/breaches` | List SLA breach records | Authenticated | `analytics:read:team` | `SlaBreach` |
| `PUT` | `/sla/settings` | Update response thresholds | Authenticated | `settings:manage` | `Tenant` |

### Group 5: SaaS Subscriptions, Billing & Platform (34 Endpoints)
| Method | Path | Summary / Operation | Auth | Permissions | Database Entities |
|---|---|---|---|---|---|
| `GET` | `/billing/plans` | List available subscription tiers| Authenticated | None | `Plan`, `PlanEntitlement` |
| `GET` | `/billing/profile` | Get GST billing information | Authenticated | `billing:manage` | `BillingProfile` |
| `PUT` | `/billing/profile` | Update GSTIN & billing address | Authenticated | `billing:manage` | `BillingProfile` |
| `POST` | `/billing/subscribe` | Initialize Razorpay subscription| Authenticated | `billing:manage` | `Subscription`, `Invoice` |
| `POST` | `/billing/change-plan` | Upgrade / downgrade tier | Authenticated | `billing:manage` | `Subscription` |
| `POST` | `/billing/cancel` | Cancel subscription | Authenticated | `billing:manage` | `Subscription` |
| `GET` | `/billing/invoices` | List historical GST invoices | Authenticated | `billing:manage` | `Invoice` |
| `GET` | `/billing/invoices/{id}` | Fetch invoice details / PDF | Authenticated | `billing:manage` | `Invoice` |
| `POST` | `/webhooks/razorpay` | Razorpay payment webhook | Public | Razorpay HMAC Signature| `BillingEvent`, `Payment` |
| `GET` | `/usage` | Get workspace usage & quotas | Authenticated | `usage:read` | `PlanEntitlement` |
| `GET` | `/reports/{key}` | Fetch analytical report data | Authenticated | `analytics:read:all` | `Lead`, `StageTransition` |
| `GET` | `/reports/{key}/export` | Export report to CSV | Authenticated | `analytics:read:all` | `Lead`, `AuditLog` |
| `POST` | `/platform/auth/login` | Super admin portal login | Public | None | `PlatformAdmin` |
| `GET` | `/platform/metrics` | Global platform KPIs & MRR | Platform Token | Super Admin | System Aggregates |
| `GET` | `/platform/tenants` | List all system workspaces | Platform Token | Super Admin | `Tenant`, `Plan` |
| `POST` | `/platform/tenants/{id}/suspend`| Suspend tenant workspace | Platform Token | Super Admin | `Tenant` |
| `POST` | `/platform/tenants/{id}/support-session`| Launch support session | Platform Token | Super Admin | `SupportAccessSession` |
| `GET` | `/platform/ops` | Live health & queue status | Platform Token | Super Admin | `OpsAlert`, `EventMark` |

### Group 6: Public Developer API (`/v1/*`) (15 Endpoints)
| Method | Path | Summary / Operation | Auth | Permissions | Database Entities |
|---|---|---|---|---|---|
| `GET` | `/v1/me` | Inspect API key scopes | Scoped API Key | None | `ApiKey`, `Tenant` |
| `GET` | `/v1/leads` | List leads externally | Scoped API Key | `lead:read` | `Lead` |
| `POST` | `/v1/leads` | Create lead externally | Scoped API Key | `lead:write` + Idempotency | `Lead`, `LeadActivity` |
| `GET` | `/v1/leads/{id}` | Get lead record | Scoped API Key | `lead:read` | `Lead` |
| `PATCH` | `/v1/leads/{id}` | Update lead record | Scoped API Key | `lead:write` | `Lead` |
| `DELETE` | `/v1/leads/{id}` | Delete lead | Scoped API Key | `lead:write` | `Lead` |
| `POST` | `/v1/leads/{id}/stage` | Transition lead stage | Scoped API Key | `lead:write` | `Lead`, `StageTransition` |
| `GET` | `/v1/conversations` | List conversation threads | Scoped API Key | `conversation:read` | `Conversation` |
| `GET` | `/v1/conversations/{id}/messages`| Read chat history | Scoped API Key | `conversation:read` | `Message` |
| `GET` | `/v1/appointments` | List booked appointments | Scoped API Key | `appointment:read` | `Appointment` |
| `POST` | `/v1/appointments` | Book appointment | Scoped API Key | `appointment:write` + Idempotency| `Appointment` |
| `GET` | `/v1/openapi.json` | OpenAPI 3.0 specification | Public | None | None |
