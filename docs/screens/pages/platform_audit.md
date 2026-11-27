# Platform Audit Log (`/platform/audit`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/audit`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/audit/page.tsx)

## Purpose & Business Functionality
Append-only log of platform staff logins and tenant interventions.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `card`, `badge`, `input`, `button`, `skeleton`, `avatar`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/platform`
- **Primary Data Models**: `PlatformAuditLog`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Platform sidebar **Audit**
- **Outgoing**: `/platform/tenants/[id]`
