# Outbound Webhooks (`/webhooks`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/webhooks`
- **Access & Permissions**: Authenticated (`integration:manage` + `api_access` feature) (UI checks: `integration:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/webhooks/page.tsx)

## Purpose & Business Functionality
Configures HTTPS outbound webhook endpoints, signing secrets, delivery logs, test pings, and redeliveries.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `dialog`, `empty-state`, `field`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/format`, `@/lib/forms`
- **Primary Data Models**: `WebhookEndpoint`, `WebhookDelivery`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `webhookEndpointFormSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Webhooks**
- **Outgoing**: Self-contained
