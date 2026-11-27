# Design Preview: Lead Detail (`/design/lead`)

*Last analyzed: 2026-11-27*

- **Group**: Design & Dev
- **Route**: `/design/lead`
- **Access & Permissions**: Non-product static preview
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/design/lead/page.tsx)

## Purpose & Business Functionality
Static UI mockup of lead detail with hardcoded sample data.

## Components & UI Elements
- **Child / Feature Components**: `@/components/design/preview-frame`, `@/components/design/score-ring`
- **UI Primitives**: `avatar`, `badge`, `button`, `card`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/cn`
- **Primary Data Models**: None

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Direct URL
- **Outgoing**: None
