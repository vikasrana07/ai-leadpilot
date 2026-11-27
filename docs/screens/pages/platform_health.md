# Platform Health Summary (`/platform/health`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/health`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/health/page.tsx)

## Purpose & Business Functionality
Healthy/Degraded badge combining `/health/ready`, firing ops alerts, and outbox backlog.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/platform`
- **Primary Data Models**: `OpsAlert`, `OutboxEvent`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Platform sidebar **Health**
- **Outgoing**: `/platform/ops`
