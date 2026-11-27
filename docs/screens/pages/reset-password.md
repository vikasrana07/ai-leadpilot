# Reset Password (`/reset-password`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/reset-password`
- **Access & Permissions**: Public (`?token=...`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/reset-password/page.tsx)

## Purpose & Business Functionality
Resets user password and revokes all active sessions.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`, `field`, `input`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/forms`
- **Primary Data Models**: `PasswordResetToken`, `User`, `Session`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `schema`)

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Password reset email link
- **Outgoing**: `/login`, `/forgot-password`
