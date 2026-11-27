# Follow-Up Tasks (`/tasks`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/tasks`
- **Access & Permissions**: Authenticated workspace member (UI checks: `lead:read:all`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/tasks/page.tsx)

## Purpose & Business Functionality
Personal and team follow-up task list with Mine/All filter, status tabs, and TaskDrawer.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/crm/task-drawer`
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `empty-state`, `input`, `select`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api-generated/tasks/tasks`, `@/lib/auth`, `@/lib/crm`, `@/lib/forms`, `@/lib/cn`, `@/lib/ops`
- **Primary Data Models**: `Task`, `Lead`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Default boundary
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Tasks**
- **Outgoing**: `/leads/[id]`
