# Subscription & Billing (`/billing`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/billing`
- **Access & Permissions**: Authenticated (`billing:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/billing/page.tsx)

## Purpose & Business Functionality
Manages Razorpay subscriptions, plan upgrades/downgrades, GST billing profile, and invoices.

## Components & UI Elements
- **Child / Feature Components**: `@/components/shell/billing-banner`, `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `field`, `input`, `select`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/billing`, `@/lib/forms`, `@/lib/cn`
- **Primary Data Models**: `Subscription`, `Plan`, `BillingProfile`, `Invoice`, `Payment`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline (Schemas: `billingProfileFormSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Subscription & Billing**, `/usage`
- **Outgoing**: `/invoice/[id]`
