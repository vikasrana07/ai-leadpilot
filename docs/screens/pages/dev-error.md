# Dev Error Trigger (`/dev-error`)

*Last analyzed: 2026-11-27*

- **Group**: Design & Dev
- **Route**: `/dev-error`
- **Access & Permissions**: Development only (`notFound()` in prod)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/dev-error/page.tsx)

## Purpose & Business Functionality
Intentionally throws an error in development to test Next.js error boundaries.

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: Standard HTML / Tailwind

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`
- **Primary Data Models**: None

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Direct URL
- **Outgoing**: Error boundary
