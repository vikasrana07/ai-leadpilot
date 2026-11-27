# Platform Pending Deletions (`/platform/deletions`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/deletions`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/deletions/page.tsx)

## Purpose & Business Functionality
Monitors workspaces in the deletion cooling-off grace period.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `card`, `badge`, `skeleton`, `avatar`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/platform`
- **Primary Data Models**: `TenantDeletionRequest`, `Tenant`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Platform sidebar **Deletions**
- **Outgoing**: `/platform/tenants/[id]`
