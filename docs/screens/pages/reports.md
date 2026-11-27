# Reports & Analytics (`/reports`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/reports`
- **Access & Permissions**: Authenticated (`analytics:read:own|team|all`, `csv_export` feature)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/reports/page.tsx)

## Purpose & Business Functionality
Revenue Leakage Radar + 7 report tabs (Acquisition, Funnel, Agents, Response time, Appointments, AI, Automations) with CSV export.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/reports/revenue-leakage-radar`
- **UI Primitives**: `button`, `card`, `empty-state`, `input`, `select`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/cn`, `@/lib/reports`, `@/lib/billing`, `@/lib/pack`, `@/lib/terms-text`
- **Primary Data Models**: `Lead`, `Appointment`, `AiRun`, `AutomationRun`, `SlaBreach`, `SlotRescueOffer`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Reports & Analytics**
- **Outgoing**: CSV download
