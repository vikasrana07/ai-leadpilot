# Platform Plans & Entitlements (`/platform/plans`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/plans`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/plans/page.tsx)

## Purpose & Business Functionality
Creates and edits SaaS plans, INR pricing, trial days, and feature/limit entitlements.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `dialog`, `field`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/forms`, `@/lib/billing`, `@/lib/platform`
- **Primary Data Models**: `Plan`, `PlanEntitlement`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline (Schemas: `planFormSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Platform sidebar **Plans**
- **Outgoing**: Reflected on `/billing`
