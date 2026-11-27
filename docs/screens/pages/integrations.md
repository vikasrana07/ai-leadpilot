# Integrations & Channels (`/integrations`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace Admin
- **Route**: `/integrations`
- **Access & Permissions**: Authenticated (`integration:manage`; Calendar personal) (UI checks: `integration:manage`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/integrations/page.tsx)

## Purpose & Business Functionality
Connects WhatsApp (Embedded Signup/manual), Web Widget, Amazon SES, Google Calendar, Portal Email, Google Sheets, Messenger/Instagram, and Lead Capture API.

## Components & UI Elements
- **Child / Feature Components**: `@/components/integrations/whatsapp-card`, `@/components/integrations/widget-card`, `@/components/integrations/google-calendar-card`, `@/components/integrations/google-sheets-card`, `@/components/integrations/meta-social-card`, `@/components/integrations/portal-email-card`, `@/components/integrations/ses-card`, `@/components/page/page-header`
- **UI Primitives**: `button`, `card`, `dialog`, `input`, `skeleton`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/auth`, `@/lib/pack`, `@/lib/format`, `@/lib/forms`
- **Primary Data Models**: `Channel`, `IntegrationCredential`, `WidgetConfig`, `PortalEmailConfig`, `GoogleCalendarSync`, `GoogleSheetSync`, `ApiKey`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: None / inline

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Default boundary
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Admin sidebar **Integrations**, `/inbox` CTA
- **Outgoing**: `/inbox`, `/campaigns`, `/emails`, `/appointments`
