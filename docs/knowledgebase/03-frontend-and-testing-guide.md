# 03 — Frontend & Testing Guide (`apps/web` & `e2e`)

## Tech Stack
- **Framework**: Next.js 16 (`App Router`, port `3100`), React 19, TypeScript 6.
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`), `clsx` + `tailwind-merge` via `cn()` (`apps/web/lib/cn.ts`), `motion` for animations, `lucide-react` icons.
- **State & Data**: `@tanstack/react-query` v5, `zustand`, `react-hook-form` + `@hookform/resolvers/zod`.
- **Visualization & Canvas**: `recharts` (dashboard & reports), `@xyflow/react` (automation builder).

---

## App Router Layout (`apps/web/app/`)

- `(auth)/`: Public auth pages (`login`, `register`, `forgot-password`, `reset-password`, `verify-email`, `accept-invite`, `auth/sso/callback`).
- `(app)/`: Authenticated tenant workspace wrapped by `apps/web/app/(app)/layout.tsx` (`useMe()`, redirects `401` to `/login?next=...`, renders `AppShell`).
- `platform/`: Isolated vendor staff console wrapped by `apps/web/app/platform/layout.tsx` (`PlatformShell`).
- `data-deletion/` & `invoice/[id]/`: Standalone public/printable routes.
- `loading.tsx`: Route-level loading skeletons paired with `components/skeletons/`.

---

## Navigation, Permissions & Industry Packs

- **Sidebar & Nav (`apps/web/lib/nav.ts`)**:
  - `WORKSPACE_NAV` and `ADMIN_NAV` define all primary sidebar items, icons, `permission`, optional `module: 'properties'`, and `term: 'leads'`.
  - Use `useAuth().can('permission:key')` to gate UI buttons/panels.
  - Use `useTerms()` / `usePack()` (`apps/web/lib/pack.ts`) and `applyTerms()` (`apps/web/lib/terms-text.ts`) so labels adapt to the tenant's industry pack.

---

## API Clients (`apps/web/lib/`)

1. **Hand-written client (`apps/web/lib/api.ts`)**: `api<T>(path, options)` and `apiUpload(...)` — throws `ApiError` with status and validation `details`.
2. **Generated React Query hooks (`apps/web/lib/api-generated/`)**: Created by Orval (`pnpm codegen:api`) using `apps/web/lib/custom-instance.ts`. Prefer generated hooks for new endpoints when OpenAPI schemas are defined.
3. **Platform client (`apps/web/lib/platform.ts`)**: `platformApi<T>(...)` for `/platform/*` routes (isolated staff cookies).

---

## Reusable UI & Form Patterns (`apps/web/components/`)

- **Primitives**: `components/ui/` (`Button`, `Card`, `Badge`, `Dialog`, `Drawer`, `ConfirmDialog`, `EmptyState`, `Field`, `Input`, `Select`, `Textarea`, `Skeleton`, `Pagination`, `Dropdown`, `Avatar`).
- **Page Chrome**: `components/page/page-header.tsx` (`PageHeader` with title, description, breadcrumbs, actions).
- **Tables**: `components/data-table/` (`DataTableToolbar`, `QuickViews`, `useTablePreferences` for column visibility/pinning/density).
- **Forms**: Use `react-hook-form` + `zodResolver(schema)` from `@leadpilot/validation` and `handleApiError(err, setError)` from `apps/web/lib/forms.ts` to map backend `ZodPipe` errors onto form fields + `sonner` toasts.
- **Help tours**: step definitions live in `apps/web/lib/tours/screens/*`; a step's `target` is a `data-tour="..."` attribute on the page. `HelpTourProvider` shows only steps whose target is on screen and **re-resolves them while a tour is open** (`lib/tours/resolve-steps.ts`: `resolveSteps`, `reconcileIndex`), so no screen needs to tell the tour when its data has loaded. Put `data-tour` on elements that exist once data is loaded; they are picked up automatically.

---

## Testing & Verification

- **Typecheck & Lint**:
  - `pnpm typecheck` (runs `tsc --noEmit` across all workspaces via Turbo)
  - `pnpm lint` (runs root ESLint + Turbo `lint`)
- **Unit & Integration Tests (Vitest)**:
  - `pnpm test` (runs Vitest across `apps/api`, `apps/web`, `packages/database`, `packages/validation`)
  - Single package: `pnpm --filter @leadpilot/api test` or `pnpm --filter @leadpilot/web test`
- **End-to-End Tests (Playwright in `e2e/`)**:
  - `pnpm test:e2e` (runs `scripts/e2e.sh`)
  - Specs in `e2e/tests/` cover auth (`01`), leads (`02`), widget/inbox (`03`), billing (`04`), AI/appointments (`05`), platform (`06`), security (`07`), keyboard (`08`), MFA (`09`), axe a11y (`10`), mobile (`11`), automation builder/canvas (`12`, `14`), industry packs (`13`), retention (`15`), error pages (`16`), ops (`17`), embedded signup (`18`), and alerts (`19`).
