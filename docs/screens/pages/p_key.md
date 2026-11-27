# Customer Portal (`/p/[key]`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/p/[key]`
- **Access & Permissions**: Public (OTP -> `lp_portal` cookie)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/p/[key]/page.tsx)

## Purpose & Business Functionality
Self-service portal for leads to view/confirm/reschedule/cancel appointments and submit DPDP data requests.

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `field`, `input`, `skeleton`, `textarea`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/forms`
- **Primary Data Models**: `PortalConfig`, `PortalLoginCode`, `PortalSession`, `Appointment`, `Lead`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Shareable portal link from `/settings`
- **Outgoing**: OTP sign-in view on logout
