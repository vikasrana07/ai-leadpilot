# Workspace Onboarding (`/onboarding`)

*Last analyzed: 2026-11-27*

- **Group**: Workspace App
- **Route**: `/onboarding`
- **Access & Permissions**: Authenticated workspace member (UI checks: `team:invite`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/onboarding/page.tsx)

## Purpose & Business Functionality
7-step guided setup wizard (business, industry, team, WhatsApp, AI assistant, knowledge, qualification).

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`, `@/components/integrations/whatsapp-card`, `@/components/integrations/embedded-signup-button`
- **UI Primitives**: `badge`, `button`, `card`, `field`, `input`, `select`, `skeleton`, `textarea`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/ai`, `@/lib/api`, `@/lib/auth`, `@/lib/cn`, `@/lib/forms`, `@/lib/i18n`, `@/lib/i18n-context`, `@/lib/pack`, `@/lib/terms-text`
- **Primary Data Models**: `Tenant`, `PipelineStage`, `AiAssistant`, `KnowledgeDocument`, `ScoringRuleSet`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: `/register`, `/dashboard` setup card
- **Outgoing**: `/dashboard`
