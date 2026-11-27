# Email Verification (`/verify-email`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/verify-email`
- **Access & Permissions**: Public (`?token=...`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/verify-email/page.tsx)

## Purpose & Business Functionality
Consumes a single-use email verification token.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`
- **Primary Data Models**: `EmailVerificationToken`, `User`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Verification email link
- **Outgoing**: `/dashboard`, `/login`
