# Platform Staff MFA (`/platform/security`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/security`
- **Access & Permissions**: Authenticated `PlatformAdmin`
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/security/page.tsx)

## Purpose & Business Functionality
Manages TOTP MFA and recovery codes for the signed-in platform admin.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/security/mfa-panel`
- **UI Primitives**: `card`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/platform`
- **Primary Data Models**: `MfaCredential`, `MfaRecoveryCode`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Platform sidebar **Security**
- **Outgoing**: Self-contained
