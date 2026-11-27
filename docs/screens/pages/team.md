# Team Members & Invitations (`/team`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/team`
- **Access & Permissions**: Authenticated (`team:read`, `team:invite`, `team:manage`) (UI checks: `team:invite`, `team:manage`, `analytics:read:team`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/team/page.tsx)

## Purpose & Business Functionality
Manages active/deactivated members, 7-day invitations, role changes, MFA resets, and per-member permission overrides.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/team/member-permissions-dialog`
- **UI Primitives**: `avatar`, `badge`, `button`, `card`, `dialog`, `dropdown`, `empty-state`, `field`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/forms`
- **Primary Data Models**: `Membership`, `Invitation`, `MemberPermissionOverride`, `Role`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `inviteSchema`, `resetMfaSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Team**
- **Outgoing**: `/roles`, `/accept-invite`
