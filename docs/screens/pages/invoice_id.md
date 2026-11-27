# Printable Tax Invoice (`/invoice/[id]`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/invoice/[id]`
- **Access & Permissions**: Authenticated (`billing:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/invoice/[id]/page.tsx)

## Purpose & Business Functionality
Renders a print-ready Indian GST Tax Invoice (CGST/SGST or IGST, SAC, GSTIN).

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: `button`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/billing`
- **Primary Data Models**: `Invoice`, `BillingProfile`, `Tenant`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: `/billing`
- **Outgoing**: Browser print/PDF, `/login` on 401
