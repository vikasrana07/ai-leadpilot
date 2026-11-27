# Create Workspace (`/register`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/register`
- **Access & Permissions**: Public
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(auth)/register/page.tsx)

## Purpose & Business Functionality
Registers a new user and provisions a new LeadPilot tenant workspace.

## Components & UI Elements
- **Child / Feature Components**: `@/components/auth-layout`
- **UI Primitives**: `button`, `field`, `input`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/turnstile`, `@/lib/forms`
- **Primary Data Models**: `User`, `Tenant`, `Membership`, `Role`, `Subscription`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `registerSchema`)

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: `/login`
- **Outgoing**: `/onboarding`, `/login`
