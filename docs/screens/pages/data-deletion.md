# Meta Data Deletion Status (`/data-deletion`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/data-deletion`
- **Access & Permissions**: Public (`?code=...`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/data-deletion/page.tsx)

## Purpose & Business Functionality
Displays Meta/Facebook Embedded Signup data-deletion callback status.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`
- **Primary Data Models**: None (Meta callback status)

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Meta/Facebook settings link
- **Outgoing**: Terminal page
