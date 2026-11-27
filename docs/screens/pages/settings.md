# Workspace Settings (`/settings`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/settings`
- **Access & Permissions**: Authenticated (`settings:manage` for workspace panels) (UI checks: `settings:manage`, `analytics:read:team`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/settings/page.tsx)

## Purpose & Business Functionality
Business profile, assignment, SLA targets, canned responses, OIDC/SAML SSO, theme, active sessions, support access, and data privacy/deletion.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/privacy/workspace-privacy`, `@/components/settings/canned-responses-card`, `@/components/settings/sso-config-card`, `@/components/support/support-access-card`
- **UI Primitives**: `badge`, `button`, `card`, `field`, `input`, `select`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/i18n`, `@/lib/pack`, `@/lib/cn`, `@/lib/forms`, `@/lib/theme`
- **Primary Data Models**: `Tenant`, `Session`, `SupportAccessSession`, `TenantDeletionRequest`, `DataExport`, `PortalConfig`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `updateTenantSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Settings**
- **Outgoing**: Updates terminology across app
