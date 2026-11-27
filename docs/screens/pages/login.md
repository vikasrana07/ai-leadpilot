# Sign In (`/login`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/login`
- **Access & Permissions**: Public (`?next=<path>`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/login/page.tsx)

## Purpose & Business Functionality
Authenticates workspace users via email/password (with Turnstile), TOTP MFA/recovery code, or OIDC/SAML SSO.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`, `field`, `input`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/forms`, `@/lib/turnstile`
- **Primary Data Models**: `User`, `Session`, `MfaCredential`, `MfaRecoveryCode`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `loginSchema`)

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Unauthenticated redirect from `(app)` or `/invoice/[id]`, links from `/register`, `/forgot-password`, `/reset-password`, `/accept-invite`
- **Outgoing**: `?next` or `/dashboard`, `/forgot-password`, `/register`, External IdP -> `/auth/sso/callback`
