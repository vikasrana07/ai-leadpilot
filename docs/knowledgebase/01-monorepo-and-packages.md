# 01 — Monorepo & Shared Packages

## Workspace Layout

Managed with **pnpm workspaces** (`pnpm@11.5.1`, Node `>=22`) and **Turborepo** (`turbo.json`).

```text
ai-leadpilot/
├── apps/
│   ├── web/        # @leadpilot/web — Next.js 16 (port 3100), React 19, Tailwind v4
│   ├── api/        # @leadpilot/api — NestJS 12 REST API + SSE + BullMQ processors
│   └── worker/     # @leadpilot/worker — Background worker entrypoints (delegates to apps/api)
├── packages/
│   ├── database/     # @leadpilot/database — Prisma client, migrations, RLS helper, seeds
│   ├── validation/   # @leadpilot/validation — Shared Zod schemas (API + Web forms)
│   └── shared-types/ # @leadpilot/shared-types — Permission keys, industry packs, DTOs, openapi.json
├── e2e/              # Playwright E2E, axe accessibility, keyboard & responsive suites
├── infrastructure/   # Docker Compose (Postgres, Redis, etc.), monitoring, ECS reference
├── scripts/          # e2e.sh, loadtest, smoke probes, orval-fix-imports.mjs
└── docs/             # Architecture, ADRs, runbooks, screens/, knowledgebase/
```

---

## `@leadpilot/database` (`packages/database`)

- **Schema**: `packages/database/prisma/schema.prisma`
- **Client**: `createPrismaClient(connectionString)` in `packages/database/src/index.ts` attaches `PrismaPg` and `softDeleteExtension`.
- **Multi-Tenancy (Mandatory)**:
  - **NEVER** query tenant-owned tables directly without setting the transaction-local PostgreSQL RLS context.
  - Always wrap tenant queries in:
    ```ts
    await withTenant(this.prisma, { tenantId: tenant.tenantId, userId: tenant.userId }, async (tx) => {
      return tx.lead.findMany(...);
    });
    ```
  - `withTenant` validates UUIDs and executes `SELECT set_config('app.tenant_id', ..., true), set_config('app.user_id', ..., true)` inside a transaction.
- **Soft Deletes**: `packages/database/src/soft-delete.ts` automatically filters/handles soft-deleted models via `softDeleteExtension`.
- **Industry Packs**: `packages/database/src/industry-pack.ts` (`applyIndustryPack`, `switchIndustryPack`) provisions default pipeline stages, custom fields, and module flags per tenant industry.
- **Commands**:
  - `pnpm db:generate` — Regenerate Prisma client after schema edits.
  - `pnpm db:migrate` — Apply/create Prisma migrations.
  - `pnpm db:seed` — Seed initial development data.

---

## `@leadpilot/validation` (`packages/validation`)

- Contains Zod (`zod@4.6.7`) schemas organized by domain:
  - `automation-graph.ts`, `billing.ts`, `campaigns.ts`, `crm.ts`, `email-tracking.ts`, `integrations.ts`, `ops.ts`, `portal.ts`, `index.ts`.
- **Single Source of Truth**: Import the same schema in both:
  - NestJS controllers via `new ZodPipe(schema)`
  - Next.js forms via `zodResolver(schema)` from `@hookform/resolvers/zod`

---

## `@leadpilot/shared-types` (`packages/shared-types`)

- `src/permissions.ts`: Canonical `PermissionKey` definitions used by `@RequirePermissions(...)` on the backend and `useAuth().can(...)` / `nav.ts` on the frontend.
- `src/industry-packs.ts` & `src/terms-text.ts`: Industry-specific terminology (`Leads` / `Enquiries` / `Customers`), appointment labels, and enabled modules (e.g., `properties`).
- `openapi.json`: Generated from NestJS controllers by `pnpm codegen:api` and consumed by Orval.
