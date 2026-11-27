# Email Tracking & Suppressions (`/emails`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/emails`
- **Access & Permissions**: Authenticated (`email:read:own|all`, `email:suppress:manage`) (UI checks: `email:suppress:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/emails/page.tsx)

## Purpose & Business Functionality
Monitors tracked email delivery/engagement (SES/SMTP) and manages the email suppression list.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `dialog`, `empty-state`, `input`, `select`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/cn`, `@/lib/format`, `@/lib/forms`, `@/lib/auth`
- **Primary Data Models**: `TrackedEmail`, `EmailEngagementEvent`, `EmailSuppression`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Default boundary
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Email Tracking**
- **Outgoing**: `/leads/[id]`
