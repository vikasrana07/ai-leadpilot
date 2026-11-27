# Leads Directory (`/leads`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/leads`
- **Access & Permissions**: Authenticated (`lead:read:own` or `lead:read:all`) (UI checks: `lead:read:all`, `lead:write:all`, `lead:write:own`, `lead:import`, `lead:export`, `lead:assign`, `campaign:manage`, `lead:delete`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/leads/page.tsx)

## Purpose & Business Functionality
Searchable, filterable, customizable data table of leads with CSV import/export and bulk actions.

## Components & UI Elements
- **Child / Feature Components**: `@/components/crm/import-dialog`, `@/components/crm/lead-form-dialog`, `@/components/crm/whatsapp-opt-in-dialog`, `@/components/crm/lead-badges`, `@/components/data-table`, `@/components/page/page-header`
- **UI Primitives**: `avatar`, `button`, `card`, `confirm-dialog`, `empty-state`, `pagination`, `select`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/cn`, `@/lib/crm`, `@/lib/format`, `@/lib/pack`, `@/lib/i18n`
- **Primary Data Models**: `Lead`, `PipelineStage`, `LeadSource`, `Tag`, `CustomFieldDefinition`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Leads**, `/pipeline` See all
- **Outgoing**: `/leads/[id]`
