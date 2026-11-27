# Create Automation (`/automations/new`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/automations/new`
- **Access & Permissions**: Authenticated (`automation:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/automations/new/page.tsx)

## Purpose & Business Functionality
Dual-mode Outline + Visual Canvas (`@xyflow/react`) editor for creating new automations.

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: None
- **Primary Data Models**: `Automation`, `AutomationVersion`

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
