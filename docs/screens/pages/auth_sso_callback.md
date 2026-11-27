# SSO Callback (`/auth/sso/callback`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/auth/sso/callback`
- **Access & Permissions**: Public
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/auth/sso/callback/page.tsx)

## Purpose & Business Functionality
Completes OIDC/SAML Single Sign-On after IdP redirect.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`
- **Primary Data Models**: `User`, `Session`, `Tenant`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: External Identity Provider
- **Outgoing**: `/dashboard`, `/login`
