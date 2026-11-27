# Property Inventory (`/properties`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/properties`
- **Access & Permissions**: Authenticated (`property:read`, `property:manage`; pack module `properties`) (UI checks: `lead:write:all`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/properties/page.tsx)

## Purpose & Business Functionality
Manages real estate listings (projects, units, price, status) with CSV import.

## Components & UI Elements
- **Child / Feature Components**: `@/components/crm/import-dialog`, `@/components/data-table`, `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `empty-state`, `field`, `input`, `pagination`, `select`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/cn`, `@/lib/crm`, `@/lib/format`, `@/lib/forms`
- **Primary Data Models**: `Property`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported (Schemas: `propertyFormSchema`)

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Properties**
- **Outgoing**: Self-contained
