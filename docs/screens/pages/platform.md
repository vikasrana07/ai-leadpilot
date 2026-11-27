# Platform Overview (`/platform`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/page.tsx)

## Purpose & Business Functionality
Whole-platform KPIs, subscription breakdown, and revenue metrics.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/platform/platform-kpi-card`
- **UI Primitives**: `card`, `button`, `badge`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/billing`, `@/lib/platform`
- **Primary Data Models**: `Tenant`, `Subscription`, `Payment`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: `/platform/login`, Platform sidebar **Overview**
- **Outgoing**: `/platform/tenants`, `/platform/plans`, `/platform/ops`
