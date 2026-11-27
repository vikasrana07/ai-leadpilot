# Campaign Detail & Follow-ups (`/campaigns/[id]`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/campaigns/[id]`
- **Access & Permissions**: Authenticated (`campaign:read`, `campaign:manage`) (UI checks: `campaign:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/campaigns/[id]/page.tsx)

## Purpose & Business Functionality
Delivery/read/reply gauges, WhatsApp preview, recipient table, failed retry, and cohort follow-ups.

## Components & UI Elements
- **Child / Feature Components**: `@/components/campaigns/delivery-gauge`, `@/components/campaigns/whatsapp-preview`, `@/components/campaigns/send-followup-dialog`
- **UI Primitives**: `button`, `confirm-dialog`, `badge`, `card`, `input`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/auth`, `@/lib/campaigns`
- **Primary Data Models**: `BroadcastCampaign`, `BroadcastRecipient`, `WhatsappTemplate`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: `/campaigns`
- **Outgoing**: `/campaigns`, `/leads/[id]`
