# Sales Pipeline (`/pipeline`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/pipeline`
- **Access & Permissions**: Authenticated (`pipeline:manage` to configure) (UI checks: `lead:write:all`, `pipeline:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/pipeline/page.tsx)

## Purpose & Business Functionality
Drag-and-drop Kanban board grouped by `OPEN`/`WON`/`LOST` pipeline stages.

## Components & UI Elements
- **Child / Feature Components**: `@/components/crm/lead-badges`, `@/components/crm/stage-config-dialog`, `@/components/page/page-header`
- **UI Primitives**: `avatar`, `button`, `dialog`, `dropdown`, `empty-state`, `field`, `select`, `textarea`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/cn`, `@/lib/crm`, `@/lib/format`, `@/lib/pack`
- **Primary Data Models**: `PipelineStage`, `Lead`, `LostReason`, `StageTransition`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Sidebar **Sales Pipeline**
- **Outgoing**: `/leads/[id]`, `/leads?stageId=...`
