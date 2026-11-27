# Platform Tenants Registry (`/platform/tenants`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/tenants`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/tenants/page.tsx)

## Purpose & Business Functionality
Searchable and filterable registry of all customer workspaces.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `input`, `select`, `skeleton`, `avatar`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/billing`, `@/lib/platform`
- **Primary Data Models**: `Tenant`, `Subscription`, `Plan`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Platform sidebar **Workspaces & Tenants**
- **Outgoing**: `/platform/tenants/[id]`
