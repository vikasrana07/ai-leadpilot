# Developer API Keys (`/api-keys`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/api-keys`
- **Access & Permissions**: Authenticated (`integration:manage`) (UI checks: `integration:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/api-keys/page.tsx)

## Purpose & Business Functionality
Creates, scopes, monitors, and revokes API keys for `/v1/*` and `/public/leads`.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `empty-state`, `field`, `input`, `select`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/format`, `@/lib/forms`, `@/lib/pack`, `@/lib/terms-text`
- **Primary Data Models**: `ApiKey`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `createApiKeySchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **API keys**
- **Outgoing**: `/billing`
