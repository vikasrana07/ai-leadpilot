# Shared Omnichannel Inbox (`/inbox`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/inbox`
- **Access & Permissions**: Authenticated (`conversation:read:own|all`, `conversation:reply`) (UI checks: `conversation:read:all`, `integration:manage`, `conversation:reply`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/inbox/page.tsx)

## Purpose & Business Functionality
3-pane real-time messaging for WhatsApp, Web Chat, Messenger, and Instagram with AI Shadow Drafts, Open Promises, Deal Pulse, notes, canned responses, and 24h window templates.

## Components & UI Elements
- **Child / Feature Components**: `@/components/inbox/details-panel`, `@/components/inbox/thread`
- **UI Primitives**: `avatar`, `badge`, `button`, `dialog`, `empty-state`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/i18n-context`, `@/lib/cn`, `@/lib/crm`, `@/lib/format`, `@/lib/inbox`
- **Primary Data Models**: `Conversation`, `Message`, `ConversationNote`, `Channel`, `Lead`, `Consent`, `WhatsappTemplate`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: `EmptyState` component rendered when no items match
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **Inbox**
- **Outgoing**: `/leads/[id]`, `/integrations`
