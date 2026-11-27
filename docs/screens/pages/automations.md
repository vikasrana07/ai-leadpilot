# Automations & Run History (`/automations`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/automations`
- **Access & Permissions**: Authenticated (`automation:manage` + `automations` plan feature) (UI checks: `automation:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/automations/page.tsx)

## Purpose & Business Functionality
Manages event-driven workflows, industry templates, dry-run tests, and live run history.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `empty-state`, `field`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/crm`, `@/lib/forms`, `@/lib/ops`, `@/lib/format`, `@/lib/pack`, `@/lib/terms-text`, `@/lib/cn`
- **Primary Data Models**: `Automation`, `AutomationVersion`, `AutomationRun`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Automations**
- **Outgoing**: `/automations/new`, `/automations/[id]/edit`
