# AI Assistant & Scoring (`/ai-assistant`)

*Last analyzed: 2026-11-27*

- **Group**: AI & Automation
- **Route**: `/ai-assistant`
- **Access & Permissions**: Authenticated (`ai:configure`)
- **Main Page Component**: [page.tsx](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/apps/web/app/(app)/ai-assistant/page.tsx)

## Purpose & Business Functionality
Configures AI persona, Shadow-to-Live Auto-Pilot, languages, handover rules, allowed tools, lead scoring rules, and monthly token usage.

## Components & UI Elements
- **Child / Feature Components**: `@/components/page/page-header`
- **UI Primitives**: `badge`, `button`, `card`, `field`, `input`, `select`, `skeleton`, `textarea`

## API Dependencies & Data Models
- **Client Libraries**: `@/lib/api`, `@/lib/ai`, `@/lib/cn`, `@/lib/format`, `@/lib/pack`, `@/lib/terms-text`
- **Primary Data Models**: `AiAssistant`, `AiRun`, `ScoringRuleSet`

## Validation Rules
- **Shared Validation (`@leadpilot/validation`)**: Imported

## UI States
- **Loading**: Skeleton / loading state present
- **Empty**: N/A or inline empty message
- **Error**: Inline error banner / query error handling
- **Success**: Toast feedback (`sonner`) and query invalidation

## Navigation Relationships
- **Incoming**: Sidebar **AI Assistant**
- **Outgoing**: Works with `/knowledge` and `/inbox`
