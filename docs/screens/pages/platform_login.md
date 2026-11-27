# Platform Staff Login (`/platform/login`)

*Last analyzed: 2026-11-27*

- **Group**: Platform Console
- **Route**: `/platform/login`
- **Access & Permissions**: Public (isolated staff auth)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/platform/login/page.tsx)

## Purpose & Business Functionality
Authenticates internal LeadPilot staff with email, password, and mandatory TOTP MFA.

## Components & UI Elements
- **Child / Feature Components**: `@/components/shell/theme-switcher`
- **UI Primitives**: `button`, `card`, `field`, `input`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/platform`
- **Primary Data Models**: `PlatformAdmin`, `MfaCredential`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Direct URL / `/platform/*` redirect
- **Outgoing**: `/platform`
