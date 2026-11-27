# Roles & Permissions (`/roles`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/roles`
- **Access & Permissions**: Authenticated (`team:read`, `role:manage`) (UI checks: `role:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/roles/page.tsx)

## Purpose & Business Functionality
Displays system roles and builds custom roles with granular `PermissionKey` matrices.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/roles/role-builder-dialog`
- **UI Primitives**: `badge`, `button`, `card`, `dialog`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`
- **Primary Data Models**: `Role`, `RolePermission`, `Permission`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Roles & Permissions**
- **Outgoing**: `/team`
