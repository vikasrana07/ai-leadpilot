# Knowledge Base (`/knowledge`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/knowledge`
- **Access & Permissions**: Authenticated (`knowledge:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/knowledge/page.tsx)

## Purpose & Business Functionality
Uploads, virus-scans, chunks, and vector-indexes PDF/DOCX/TXT/MD/CSV documents for RAG retrieval and search testing.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `confirm-dialog`, `dialog`, `empty-state`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/ai`, `@/lib/cn`, `@/lib/format`, `@/lib/forms`
- **Primary Data Models**: `KnowledgeDocument`, `KnowledgeChunk`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Knowledge Base**
- **Outgoing**: Feeds `/ai-assistant`
