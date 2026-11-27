# Plan Consumption & Quotas (`/usage`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/usage`
- **Access & Permissions**: Authenticated (`usage:read`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/usage/page.tsx)

## Purpose & Business Functionality
Displays monthly consumption vs plan limits across AI tokens, messages, leads, appointments, automations, seats, and storage.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `empty-state`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/billing`, `@/lib/api`, `@/lib/ops`, `@/lib/cn`, `@/lib/pack`
- **Primary Data Models**: `Subscription`, `PlanEntitlement`, `AiRun`, `Message`, `Lead`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Admin sidebar **Usage**
- **Outgoing**: `/billing`
