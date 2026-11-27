# Appointments & Availability (`/appointments`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/appointments`
- **Access & Permissions**: Authenticated (`appointment:read:own|all`, `appointment:write`) (UI checks: `appointment:read:all`, `settings:manage`, `appointment:write`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/appointments/page.tsx)

## Purpose & Business Functionality
Weekly calendar and list view for booking, confirming, rescheduling, cancelling, no-show recovery, availability rules, and Slot Rescue.

## Components & UI Elements
- **Child / Feature Components**: `@/components/appointments/no-show-recovery-dialog`, `@/components/appointments/slot-rescue-card`, `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `dialog`, `empty-state`, `field`, `input`, `select`, `skeleton`, `textarea`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/crm`, `@/lib/pack`, `@/lib/forms`, `@/lib/ops`, `@/lib/cn`
- **Primary Data Models**: `Appointment`, `AppointmentEvent`, `AvailabilityRule`, `AvailabilityException`, `SlotRescueOffer`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline (Schemas: `bookAppointmentSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Appointments**, `/leads/[id]`
- **Outgoing**: `/leads/[id]`, `/p/claim/[token]`
