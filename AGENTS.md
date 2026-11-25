# AI LeadPilot — Agent Instructions

## Project Structure & Knowledgebase

Before building a new feature or updating an existing one, consult the **[Agent Knowledgebase](docs/knowledgebase/README.md)** and **[Screen Documentation](docs/screens/README.md)**:

- **Monorepo (`pnpm` + `turbo`)**:
  - `apps/web` (`@leadpilot/web`): Next.js 16 App Router (port 3100), React 19, Tailwind v4, React Query, `react-hook-form` + Zod.
  - `apps/api` (`@leadpilot/api`): NestJS 12 REST API + SSE + BullMQ processors (ESM imports use `.js` extensions).
  - `apps/worker` (`@leadpilot/worker`): Background worker entrypoints delegating to `apps/api/src/worker*.ts`.
  - `packages/database` (`@leadpilot/database`): Prisma schema (`prisma/schema.prisma`), migrations, soft-delete extension, and `withTenant()` RLS helper.
  - `packages/validation` (`@leadpilot/validation`): Shared Zod schemas used by both API `ZodPipe` and Web forms.
  - `packages/shared-types` (`@leadpilot/shared-types`): Canonical `PermissionKey`s, industry packs, DTOs, and `openapi.json`.
  - `e2e/`: Playwright E2E, axe accessibility, keyboard, and responsive tests.

### Non-Negotiable Engineering Rules

1. **Tenant Isolation**: Never query tenant-scoped tables without `withTenant(prisma, { tenantId, userId }, async (tx) => ...)` from `@leadpilot/database`. Never trust `tenantId` from request input.
2. **Auth & RBAC**: All API routes are protected by global `AuthGuard`, `TenantGuard`, `PlanGuard`, and `PermissionsGuard`. Explicitly annotate routes with `@RequirePermissions(...)` (or `@Public()` / `@NoTenant()`). On the frontend, gate UI with `useAuth().can(...)` and `apps/web/lib/nav.ts`.
3. **Shared Validation**: Define request/form schemas once in `@leadpilot/validation` and reuse them in both `new ZodPipe(schema)` (API) and `zodResolver(schema)` (Web).
4. **Industry Terminology**: Use `useTerms()` / `usePack()` / `applyTerms()` on the frontend instead of hardcoding industry-specific nouns like "Leads" or "Appointments" where pack terms apply.
5. **Codegen & Verification**:
   - After schema changes: `pnpm db:migrate && pnpm db:generate`
   - After API endpoint/DTO changes: `pnpm codegen:api`
   - Before finishing: `pnpm typecheck && pnpm lint && pnpm test` (and relevant `e2e/tests/*.spec.ts` when UI/flows change).

---

## Keep Screen & Feature Documentation Up to Date

Whenever you add a new feature, screen, or route, or update an existing feature's behavior, UI workflow, permissions, or navigation:

1. **Update `docs/screens/`**:
   - Update the corresponding module file in `docs/screens/`:
     - `docs/screens/01-auth-and-onboarding.md` — Auth, public, onboarding, data-deletion, invoice
     - `docs/screens/02-crm-and-messaging.md` — Dashboard, leads, pipeline, inbox, emails, campaigns, properties
     - `docs/screens/03-ai-and-automation.md` — AI assistant, knowledge base, appointments, tasks, automations, reports
     - `docs/screens/04-workspace-admin.md` — Team, roles, integrations, API keys, webhooks, billing, usage, audit, security, settings
     - `docs/screens/05-platform-console.md` — `/platform/*` staff console screens & non-product routes
   - For any new or modified screen, ensure its entry accurately reflects:
     - **Route & Access** (URL, permissions, plan/pack gating)
     - **What It Does** (purpose and key UI sections/tabs/dialogs)
     - **User Flow** (step-by-step actions)
     - **Navigation & Direction** (incoming entry points and outgoing links/redirects)
     - **Technical Reference** (`page.tsx` path and primary API endpoints)
   - If you add or remove a route or change screen-to-screen navigation, also update the index table and Mermaid flowcharts in `docs/screens/README.md`.

2. **Update Related Docs**:
   - If the change affects architecture, patterns, APIs, database schema, or user guides, update `docs/knowledgebase/` and the corresponding files under `docs/` as part of the same task before finishing.
