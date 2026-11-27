# Account & Workspace MFA (`/security`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/security`
- **Access & Permissions**: Authenticated (`settings:manage` for workspace policy) (UI checks: `settings:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/security/page.tsx)

## Purpose & Business Functionality
Personal TOTP MFA enrollment & recovery codes, plus owner toggle to require MFA workspace-wide.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/security/mfa-panel`
- **UI Primitives**: `button`, `card`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`
- **Primary Data Models**: `MfaCredential`, `MfaRecoveryCode`, `Tenant`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Security**
- **Outgoing**: `/dashboard`
