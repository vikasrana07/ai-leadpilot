# Workspace Audit Logs (`/audit`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/audit`
- **Access & Permissions**: Authenticated (`audit:read`) (UI checks: `audit:read`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/audit/page.tsx)

## Purpose & Business Functionality
Cursor-paginated workspace audit log with signed WORM `.jsonl` export.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `empty-state`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`
- **Primary Data Models**: `AuditLog`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Audit Logs**
- **Outgoing**: Downloads `.jsonl`
