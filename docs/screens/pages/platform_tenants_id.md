# Platform Tenant Detail (`/platform/tenants/[id]`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/tenants/[id]`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/tenants/[id]/page.tsx)

## Purpose & Business Functionality
Inspects tenant subscription, usage, members, invoices; allows suspend/reactivate, plan override, and read-only support access.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/support/support-start`, `@/components/platform/platform-progress-bar`
- **UI Primitives**: `badge`, `button`, `card`, `dialog`, `field`, `input`, `select`, `textarea`, `avatar`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/forms`, `@/lib/billing`, `@/lib/platform`
- **Primary Data Models**: `Tenant`, `Subscription`, `Membership`, `Invoice`, `SupportAccessSession`, `PlatformAuditLog`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline (Schemas: `tenantActionSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: `/platform/tenants`, `/platform/audit`, `/platform/deletions`
- **Outgoing**: `/platform/tenants`, Customer workspace (support mode)
