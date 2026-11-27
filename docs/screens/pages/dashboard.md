# Workspace Dashboard (`/dashboard`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/dashboard`
- **Access & Permissions**: Authenticated workspace member (UI checks: `lead:write:all`, `lead:write:own`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/dashboard/page.tsx)

## Purpose & Business Functionality
Executive KPIs, Morning Brief, Lead Acquisition & Pipeline charts, Hot leads, Upcoming follow-ups, Lead sources.

## Components & UI Elements
- **Child / Feature Components**: `@/components/crm/lead-form-dialog`, `@/components/dashboard/morning-brief-card`, `@/components/page/page-header`
- **UI Primitives**: `avatar`, `badge`, `button`, `card`, `empty-state`, `input`, `kpi-card`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/i18n-context`, `@/lib/pack`, `@/lib/cn`, `@/lib/crm`, `@/lib/format`
- **Primary Data Models**: `Lead`, `PipelineStage`, `Appointment`, `Task`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Post-login default, Sidebar **Dashboard**
- **Outgoing**: `/onboarding`, `/leads/[id]`, quick-create lead dialog
