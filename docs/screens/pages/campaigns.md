# WhatsApp Broadcasts (`/campaigns`)

*Last analyzed: 2026-11-27*

- **Group**: CRM & Messaging
- **Route**: `/campaigns`
- **Access & Permissions**: Authenticated (`campaign:read`, `campaign:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/campaigns/page.tsx)

## Purpose & Business Functionality
Lists WhatsApp broadcast campaigns with delivery/read/opt-out KPIs and creation wizard.

## Components & UI Elements
- **Child / Feature Components**: `@/components/campaigns/create-campaign-dialog`
- **UI Primitives**: `button`, `badge`, `skeleton`, `card`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/campaigns`
- **Primary Data Models**: `BroadcastCampaign`, `WhatsappTemplate`, `Channel`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Direct navigation / state update

## Navigation Relationships
- **Incoming**: Sidebar **Broadcasts**
- **Outgoing**: `/campaigns/[id]`
