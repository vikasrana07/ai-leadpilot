# API Reference & Integration Surface

*Last analyzed: 2026-11-27*
*OpenAPI spec: [openapi.json](file:///Users/vikasrana/Documents/GitHub/ai-leadpilot/packages/shared-types/openapi.json) (286 paths, 357 operations across 59 tags)*

## API Conventions

- **Base URL**: `http://localhost:4000` (dev), configured via `NEXT_PUBLIC_API_URL` / `PUBLIC_API_URL`.
- **Interactive Docs**: Swagger UI served at `/docs` when `NODE_ENV !== 'production'` or `API_DOCS_ENABLED=true`.
- **Validation**: All request bodies and queries are validated via `new ZodPipe(schema)` using `@leadpilot/validation`. Validation failures return `400` with `{ code: 'validation_error', details: [...] }`.
- **Codegen**: Run `pnpm codegen:api` after modifying NestJS controllers/DTOs to regenerate `packages/shared-types/openapi.json` and `apps/web/lib/api-generated/`.

---

## Authentication Mechanisms

| Mechanism | Header / Cookie | Used By | Guard |
|---|---|---|---|
| **Workspace Session** | `access` httpOnly cookie or `Authorization: Bearer <jwt>` + refresh cookie | `apps/web` `(app)` routes | `AuthGuard` + `TenantGuard` |
| **Platform Staff Session** | Isolated platform cookies | `apps/web` `/platform/*` | `@Public()` controller + `PlatformAuth` |
| **Customer Portal Session** | `lp_portal` httpOnly cookie (OTP-verified) | `/p/[key]` | `@Public()` + `PortalAuth` |
| **Public REST API (`/v1/*`)** | `Authorization: Bearer <api_key>` | External integrations | `@Public()` + `ApiKeyGuard` + `IdempotencyInterceptor` |
| **Support Access Token** | Bearer JWT with support audience | Platform staff read-only session | `AuthGuard` (`verifySupport`) |
| **Webhook Signatures** | HMAC-SHA256 / SNS Signature / Meta `X-Hub-Signature-256` | Meta, Razorpay, SES, Portal Email, Google | Route-level signature verification |

---

## Endpoint Groups by Domain

### Auth, Security & Tenancy
- **Auth (`Auth` - 15 ops)**: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/me`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/sessions`, `/auth/switch-workspace`, `/auth/invitations/preview|accept`.
- **SSO (`Sso` - 7 ops)**: `/auth/sso/initiate`, `/auth/sso/callback/oidc`, `/auth/sso/callback/saml`, `/auth/sso/config`.
- **MFA & Workspace Security (`Mfa` - 5, `WorkspaceSecurity` - 2)**: `/security/mfa/*`, `/security/workspace`.
- **Tenants, Team & Roles (`Tenants` - 6, `Team` - 9, `Roles` - 5)**: `/tenant`, `/tenant/onboarding`, `/team/members*`, `/team/invitations*`, `/roles*`.
- **Audit & Privacy (`Audit` - 2, `Privacy` - 2, `Lifecycle` - 9)**: `/audit-logs`, `/audit-logs/export` (WORM), `/privacy/*`.

### CRM, Pipeline & Capture
- **Leads (`Leads` - 25 ops)**: `/leads`, `/leads/:id`, `/leads/bulk`, `/leads/import`, `/leads/export`, `/leads/:id/stage`, `/leads/:id/notes`, `/leads/:id/activity`, `/leads/:id/tags`, `/leads/:id/attachments*`, `/leads/:id/voice-note*`, `/leads/:id/merge`.
- **Pipeline (`Pipeline` - 8 ops)**: `/pipeline/board`, `/pipeline/stages*`, `/pipeline/lost-reasons*`.
- **Properties (`Properties` - 5 ops)**: `/properties*`, `/properties/import`.
- **Capture & Public API (`Capture` - 1, `ApiKeys` - 3, `V1` - 16, `V1Docs` - 1)**: `/public/leads`, `/api-keys*`, `/v1/*`.
- **Connectors (`MetaLeadAds` - 2, `PortalEmailAdmin` - 4, `PortalEmailWebhook` - 1, `GoogleSheets` - 6)**: `/integrations/portal-email*`, `/webhooks/portal-email/:key`, `/integrations/google-sheets*`, `/webhooks/meta-lead-ads*`.

### Omnichannel Messaging, Email & Broadcasts
- **Conversations (`Conversations` - 22 ops)**: `/conversations*`, `/conversations/:id/messages`, `/conversations/:id/deal-pulse`, `/conversations/:id/shadow-draft*`, `/conversations/:id/promises*`, `/conversations/:id/read|close|reopen|handover`.
- **Channels & Webhooks (`Channels` - 14, `WhatsappWebhook` - 2, `PlatformWhatsappWebhook` - 2, `MetaCallbacks` - 3, `MetaSocialAdmin` - 3, `MetaSocialWebhook` - 2, `Telephony` - 1)**: `/channels*`, `/webhooks/whatsapp*`, `/webhooks/meta*`, `/webhooks/telephony`.
- **Web Widget (`WidgetPublic` - 5 ops)**: `/widget.js`, `/widget/:key/config|session|messages`.
- **Email Tracking (`EmailTracking` - 8, `SesWebhook` - 1, `TrackingPixel` - 2)**: `/emails*`, `/emails/suppressions*`, `/webhooks/ses`, `/track/open|click`.
- **Campaigns (`Campaigns` - 11 ops)**: `/campaigns*`, `/campaigns/:id/launch|cancel|retry-failed|recipients`.
- **Realtime (`Realtime` - 1 op)**: `GET /realtime/stream` (SSE).

### AI, Scheduling, Automations & Analytics
- **AI & Knowledge (`Ai` - 11, `Knowledge` - 8)**: `/ai/assistant`, `/ai/shadow-stats`, `/ai/shadow-mode/go-live`, `/ai/usage`, `/ai/runs`, `/scoring/rules`, `/knowledge/documents*`, `/knowledge/search`.
- **Appointments & Portal (`Appointments` - 14, `SlotRescueAdmin` - 3, `SlotRescuePublic` - 2, `Portal` - 11, `PortalAdmin` - 3, `Integrations` - 5)**: `/appointments*`, `/appointments/slots`, `/appointments/availability`, `/appointments/slot-rescue/*`, `/portal/*`, `/portal-config`, `/integrations/google-calendar*`.
- **Automations, Tasks, Notifications & SLA (`Automations` - 14, `Tasks` - 4, `Notifications` - 9, `AlertSettings` - 2, `Sla` - 2)**: `/automations*`, `/tasks*`, `/notifications*`, `/me/alert-settings`, `/sla`.
- **Analytics & Reports (`Analytics` - 3, `Reports` - 2, `Usage` - 2)**: `/analytics/overview`, `/analytics/morning-brief`, `/analytics/revenue-leakage`, `/reports/:key`, `/usage`.

### Billing, Webhooks, Platform & Health
- **Billing (`Billing` - 10, `RazorpayWebhook` - 1)**: `/billing/summary|profile|checkout|cancel|invoices*`, `/webhooks/razorpay`.
- **Outbound Webhooks (`Webhooks` - 10 ops)**: `/webhooks*`, `/webhooks/:id/deliveries|test|rotate-secret`.
- **Platform Console (`Platform` - 20, `PlatformDeletion` - 1, `SupportPlatform` - 3, `SupportSession` - 4)**: `/platform/*`.
- **Health (`Health` - 2 ops)**: `/health/live`, `/health/ready`.
