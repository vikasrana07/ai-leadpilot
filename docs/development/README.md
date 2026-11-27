# Development, Testing & Deployment Guide

*Last analyzed: 2026-11-27*

## Prerequisites & Local Stack

- **Node.js**: `>=22`
- **Package Manager**: `pnpm` (`pnpm@12.23.0` in `package.json`)
- **Local Infrastructure (`infrastructure/docker/docker-compose.yml`)**:
  - `postgres` (`pgvector/pgvector:pg17`) on host port `5433`
  - `redis` (`redis:7-alpine`) on host port `6380`
  - `mailpit` (`axllent/mailpit`) SMTP `1026`, Web UI `8026`
  - `minio` (`bitnamilegacy/minio`) S3 API `9100`, Console `9101`
  - `clamav` (`clamav/clamav:stable`) on port `3310`

Start local infra and run dev servers:
```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

---

## Environment Configuration

All API environment variables are validated at startup by `loadEnv()` in [env.ts](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/api/src/config/env.ts). Key safety guards in `NODE_ENV=production`:
- Disallows `WHATSAPP_MODE=mock`, `EMBEDDED_SIGNUP_MODE=mock`, `VIRUS_SCAN_MODE=mock`, `AI_PROVIDER=mock`, `TURNSTILE_MODE=mock`, `RAZORPAY_MODE=mock`, and `WEBHOOK_ALLOW_PRIVATE_TARGETS=true`.
- Requires `KEY_PROVIDER=kms` (unless `ALLOW_LOCAL_KEY_IN_PRODUCTION=true`), `TRACKING_SECRET`, `SELLER_GSTIN`, and `PLATFORM_REQUIRE_MFA=true` (when `PLATFORM_JWT_SECRET` is set).

---

## Common Commands (`package.json`)

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all apps in parallel via Turborepo |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Run TypeScript typechecking across all workspaces |
| `pnpm lint` | Run root ESLint + workspace `lint` scripts |
| `pnpm test` | Run Vitest unit/integration tests across workspaces |
| `pnpm test:e2e` | Run Playwright E2E suite (`scripts/e2e.sh`) |
| `pnpm db:migrate` | Run Prisma migrations (`@leadpilot/database`) |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm db:seed` | Seed development data |
| `pnpm codegen:api` | Build API, export `packages/shared-types/openapi.json`, and run Orval (`orval.config.cjs`) to regenerate `apps/web/lib/api-generated/` |

---

## Testing Architecture

- **Unit & Integration Tests (Vitest)**:
  - `packages/database/test/` (`rls-isolation.test.ts`, `soft-delete.test.ts`)
  - `packages/validation/test/` (`automation-graph.test.ts`)
  - `apps/api/test/` and `apps/web/**/*.test.ts(x)`
- **End-to-End Tests (`e2e/tests/`)**: 20 Playwright specs (`01-auth.spec.ts` through `20-help-tour.spec.ts`) covering auth, leads, widget/inbox, billing, AI/appointments, platform console, security, keyboard navigation, MFA, `@axe-core/playwright` accessibility, mobile responsiveness, automation builder/canvas, industry packs, retention settings, error pages, ops status, embedded signup, alert settings, and help tours.

---

## Deployment

- Reference cloud architecture is documented in [ecs-fargate-reference.md](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/infrastructure/ecs-fargate-reference.md) and [deployment.md](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/docs/deployment.md).
- Production runs separate stateless containers for `apps/web`, `apps/api`, `worker-outbox`, and `worker-ai` backed by RDS PostgreSQL (`pgvector`), ElastiCache Redis, Amazon S3, Amazon SES, and AWS KMS.
