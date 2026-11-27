# Slot Rescue Claim (`/p/claim/[token]`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/p/claim/[token]`
- **Access & Permissions**: Public (`?l=<leadId>`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/p/claim/[token]/page.tsx)

## Purpose & Business Functionality
1-tap guest claim page for cancelled appointment slots offered via Slot Rescue.

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: `badge`, `button`, `card`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`
- **Primary Data Models**: `SlotRescueOffer`, `Appointment`, `Lead`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: WhatsApp/notification Slot Rescue link
- **Outgoing**: Terminal confirmation; updates `/appointments`
