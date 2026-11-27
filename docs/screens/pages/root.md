# Root Redirect (`/`)

*Last analyzed: 2026-11-27*

- **Group**: Auth & Public
- **Route**: `/`
- **Access & Permissions**: Public
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/page.tsx)

## Purpose & Business Functionality
Redirects visitors immediately to `/dashboard` (which bounces to `/login` if unauthenticated).

## Components & UI Elements
- **Child / Feature Components**: Inline page implementation
- **UI Primitives**: Standard HTML / Tailwind

## API Dependencies & Data Models
- **Client Libraries**: None
- **Primary Data Models**: None

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Standard pending/disabled state
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Direct URL / bookmark
- **Outgoing**: `/dashboard`
