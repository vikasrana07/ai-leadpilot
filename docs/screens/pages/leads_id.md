# Lead 360° Detail (`/leads/[id]`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/leads/[id]`
- **Access & Permissions**: Authenticated (scoped to lead read/write) (UI checks: `lead:write:all`, `lead:delete`, `lead:assign`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/leads/[id]/page.tsx)

## Purpose & Business Functionality
Full lead profile, stage transitions, AI score & override, timeline, notes, attachments, voice-to-CRM, email composer, dedupe merge, privacy.

## Components & UI Elements
- **Child / Feature Components**: `@/components/crm/activity-timeline`, `@/components/crm/lead-attachments-card`, `@/components/crm/send-email-dialog`, `@/components/crm/voice-note-dialog`, `@/components/crm/lead-badges`, `@/components/ai/score-card`, `@/components/crm/merge-dialog`, `@/components/page/page-header`, `@/components/privacy/lead-privacy`, `@/components/crm/custom-field-inputs`
- **UI Primitives**: `avatar`, `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `empty-state`, `field`, `input`, `select`, `skeleton`, `textarea`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/cn`, `@/lib/crm`, `@/lib/format`, `@/lib/pack`, `@/lib/forms`
- **Primary Data Models**: `Lead`, `LeadNote`, `LeadActivity`, `LeadAttachment`, `LeadScore`, `StageTransition`, `TrackedEmail`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `editLeadSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: `/leads`, `/dashboard`, `/pipeline`, `/inbox`, `/tasks`
- **Outgoing**: `/leads`, `/emails`, `/appointments`
