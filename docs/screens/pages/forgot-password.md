# Forgot Password (`/forgot-password`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/forgot-password`
- **Access & Permissions**: Public
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/forgot-password/page.tsx)

## Purpose & Business Functionality
Requests a 1-hour password reset email link.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`, `field`, `input`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/turnstile`, `@/lib/forms`
- **Primary Data Models**: `PasswordResetToken`, `User`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `forgotPasswordSchema`)

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: `/login`, `/reset-password`
- **Outgoing**: `/login`
