# Accept Team Invitation (`/accept-invite`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/accept-invite`
- **Access & Permissions**: Public (`?token=...`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/accept-invite/page.tsx)

## Purpose & Business Functionality
Previews workspace/role invitation and lets new or existing users join the team.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`, `field`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/forms`
- **Primary Data Models**: `Invitation`, `Membership`, `User`, `Role`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `acceptInviteSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Team invitation email
- **Outgoing**: `/dashboard`, `/login`
