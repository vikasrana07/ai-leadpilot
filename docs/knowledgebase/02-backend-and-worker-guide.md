# 02 — Backend & Worker Guide (`apps/api` & `apps/worker`)

## Tech Stack
- **Framework**: NestJS 12 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, ESM `"type": "module"`).
- **Note on ESM imports**: Relative imports inside `apps/api/src/` use `.js` extensions (TypeScript `NodeNext`/ESM convention), e.g. `import { ZodPipe } from '../common/zod.pipe.js';`.
- **Queues & Cache**: Redis (`ioredis`) + `bullmq` for background jobs, outbox, and AI runs.
- **Auth**: Cookie-based sessions (`cookie-parser`), Argon2 password hashing, TOTP MFA, OIDC/SAML SSO, and CSRF origin middleware.

---

## Request Lifecycle & Global Guards (`apps/api/src/app.module.ts`)

1. **Middleware** (applied to `*path`):
   `requestIdMiddleware` -> `httpMetricsMiddleware` -> `accessLogMiddleware` -> `cookieParser` -> `csrfOriginMiddleware([WEB_ORIGIN])`
2. **Global Guards** (executed in order):
   1. `ThrottlerGuard` (Redis-backed rate limiting outside `NODE_ENV=test`)
   2. `AuthGuard` (parses session cookie/API key; bypass if `@Public()`)
   3. `TenantGuard` (resolves active workspace membership; bypass if `@Public()` or `@NoTenant()`)
   4. `PlanGuard` (checks subscription status & plan feature entitlements)
   5. `PermissionsGuard` (enforces `@RequirePermissions(...)` against the member's role)
3. **Global Exception Filter**: `AllExceptionsFilter` normalizes errors and attaches request IDs.

---

## Common Decorators & Pipes (`apps/api/src/common/`)

- `@Public()` — Skip authentication (auth is still parsed if present).
- `@NoTenant()` — Require authentication, but allow requests without an active workspace (e.g., `/auth/me`, workspace switching).
- `@RequirePermissions('lead:write:all')` — Require specific `PermissionKey`s on a controller or route handler.
- `@CurrentAuth()` — Inject `AuthContext`.
- `@CurrentTenant()` — Inject `TenantRequestContext` (`{ tenantId, userId, membershipId, ... }`).
- `new ZodPipe(schema)` — Validate `@Body()` or `@Query()` with a `@leadpilot/validation` schema; throws `400 BadRequestException` with `{ code: 'validation_error', details: [...] }` formatted for `handleApiError` on the frontend.

---

## Feature Modules (`apps/api/src/`)

Key modules registered in `AppModule`:
- **Auth & Security**: `auth`, `mfa`, `security`, `audit`, `privacy`, `support`, `platform`
- **CRM & Messaging**: `leads`, `pipeline`, `properties`, `capture`, `conversations`, `widget`, `portal`, `channels`, `whatsapp`, `email-tracking`, `campaigns`, `realtime` (SSE)
- **AI, Ops & Analytics**: `ai`, `ops` (appointments, tasks, automations), `analytics`, `reports`, `integrations/google-calendar`
- **Developer & Billing**: `v1` (public API), `webhooks`, `billing`, `tenants`, `team`, `roles`, `usage`, `health`

---

## Background Workers (`apps/worker` & `apps/api/src/worker*.ts`)

Worker logic lives in `apps/api/src/` so domain services are shared:
- `pnpm --filter @leadpilot/api worker` (`worker.ts`) — General jobs (automations, campaigns, knowledge indexing, lifecycle).
- `pnpm --filter @leadpilot/api worker:outbox` (`worker-outbox.ts`) — Transactional outbox / webhook deliveries.
- `pnpm --filter @leadpilot/api worker:ai` (`worker-ai.ts`) — AI conversation turns and scoring.

---

## OpenAPI & Orval Codegen

- `apps/api/src/generate-openapi.ts` boots the NestJS Swagger document and writes `packages/shared-types/openapi.json`.
- Run `pnpm codegen:api` from the repo root whenever you add or change API endpoints/DTOs to regenerate `apps/web/lib/api-generated/`.

---

## Public (unauthenticated) lookups and row-level security

Public endpoints (portal email webhook, Slot Rescue claim, channel webhooks) resolve their tenant through a `SECURITY DEFINER` SQL function (`find_portal_email_by_key`, `find_slot_rescue_by_token`, ...) called via `db.userTx(null, ...)`. These run as the table owner, so **the table must be `NO FORCE ROW LEVEL SECURITY`**, otherwise the owner is filtered by the tenant policy and the lookup silently returns no rows (a 404 in production). The app role `leadpilot_app` stays subject to RLS. After the lookup, switch to `db.tenantTx({ tenantId }, ...)`.

Guest actors (portal customers, Slot Rescue claimants) are built manually with a minimal permission set; grant only what the downstream service checks (for example `lead:write:all` when creating an appointment) and validate the target lead/offer first.

## Per-member permission overrides

`resolveEffectivePermissions(rolePermissions, overrides)` (`apps/api/src/common/permissions.util.ts`) applies per-member `GRANT`/`REVOKE` rows on top of role permissions. `TenantGuard` uses it for every request; managed in the UI via `components/team/member-permissions-dialog.tsx`.
