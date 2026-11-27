# Platform Ops & Alerts (`/platform/ops`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/ops`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/ops/page.tsx)

## Purpose & Business Functionality
Real-time operational dashboard showing firing `OpsAlert`s, runbook links, worker heartbeats, and queue depths.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/platform`, `@/lib/cn`
- **Primary Data Models**: `OpsAlert`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Platform sidebar **Ops**, `/platform/health`
- **Outgoing**: Self-contained
