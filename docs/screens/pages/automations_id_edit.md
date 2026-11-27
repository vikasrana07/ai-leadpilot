# Edit Automation (`/automations/[id]/edit`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/automations/[id]/edit`
- **Access & Permissions**: Authenticated (`automation:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/automations/[id]/edit/page.tsx)

## Purpose & Business Functionality
Edits existing automations or overlays a historical `?run=<runId>` execution path on the canvas.

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: None
- **Primary Data Models**: `Automation`, `AutomationVersion`, `AutomationRun`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: `/automations`
- **Outgoing**: `/automations`
