# AI LeadPilot — Agent Knowledgebase

This knowledgebase equips Antigravity (`agy`) and other coding agents with everything needed to build new features or update existing ones cleanly and safely in **AI LeadPilot**.

## Guides

| Guide | What It Covers |
|---|---|
| [01 — Monorepo & Shared Packages](01-monorepo-and-packages.md) | Repository layout, Turborepo, `packages/database` (Prisma + `withTenant` RLS + soft deletes), `packages/validation`, `packages/shared-types` (permissions & industry packs) |
| [02 — Backend & Workers](02-backend-and-worker-guide.md) | NestJS 12 architecture (`apps/api`), global guard order, decorators, `ZodPipe`, BullMQ workers (`apps/worker`), OpenAPI & Orval codegen |
| [03 — Frontend & Testing](03-frontend-and-testing-guide.md) | Next.js 16 App Router (`apps/web`), navigation & permissions, API clients, UI primitives, forms, Vitest & Playwright E2E |

## Also See
- **Screen-by-Screen Reference**: [docs/screens/README.md](../screens/README.md)
- **Architecture & Decisions**: `docs/architecture.md`, `docs/database-schema.md`, `docs/api-specification.md`, `docs/roles-and-access.md`, `docs/decisions/`

---

## Feature Implementation Checklist

When adding or updating a full-stack feature, follow this order:

1. **Database (`packages/database`)**:
   - Update `packages/database/prisma/schema.prisma`.
   - Run `pnpm db:migrate` and `pnpm db:generate`.
   - Ensure tenant-scoped tables include `tenantId` and are queried exclusively via `withTenant(prisma, ctx, ...)`.
2. **Validation & Shared Types (`packages/validation`, `packages/shared-types`)**:
   - Add/update Zod schemas in `packages/validation/src/` (shared between API `ZodPipe` and Web `react-hook-form`).
   - Add any new permission keys to `packages/shared-types/src/permissions.ts` and industry-pack terms to `packages/shared-types/src/industry-packs.ts`.
3. **Backend API (`apps/api/src`)**:
   - Create or update the NestJS module, controller, and service; register new modules in `apps/api/src/app.module.ts`.
   - Apply `@RequirePermissions(...)` (or `@Public()` / `@NoTenant()`), `@CurrentTenant()`, and `new ZodPipe(schema)`.
   - Add/update Vitest unit/integration tests in `apps/api/test` or `*.spec.ts`.
4. **OpenAPI & Client Codegen**:
   - Run `pnpm codegen:api` to regenerate `packages/shared-types/openapi.json` and `apps/web/lib/api-generated/` (Orval React Query hooks).
5. **Frontend (`apps/web`)**:
   - Add/update routes under `apps/web/app/(app)/`, `(auth)/`, or `platform/`.
   - Register sidebar links, icons, and permissions in `apps/web/lib/nav.ts`.
   - Reuse `components/ui/`, `components/page/page-header.tsx`, `components/data-table/`, and `components/skeletons/`.
6. **Verify**:
   - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and relevant Playwright specs (`pnpm test:e2e`).
7. **Update Documentation**:
   - Update the matching screen file in `docs/screens/` (and `docs/screens/README.md` if routes/navigation changed).
