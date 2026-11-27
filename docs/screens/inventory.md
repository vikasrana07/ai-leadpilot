# Screen Inventory (55 Screens)

*Last analyzed: 2026-11-27*

Every `page.tsx` route discovered in `apps/web/app/` has a dedicated documentation file in `docs/screens/pages/`. For grouped user-flow narratives, also see the 5 module guides ([01](01-auth-and-onboarding.md), [02](02-crm-and-messaging.md), [03](03-ai-and-automation.md), [04](04-workspace-admin.md), [05](05-platform-console.md)).

| Route | Screen Name | Group | Access | Document |
|---|---|---|---|---|
| `/ai-assistant` | AI Assistant & Scoring | AI & Automation | Authenticated (`ai:configure`) | [ai-assistant.md](pages/ai-assistant.md) |
| `/api-keys` | Developer API Keys | Workspace Admin | Authenticated (`integration:manage`) | [api-keys.md](pages/api-keys.md) |
| `/appointments` | Appointments & Availability | AI & Automation | Authenticated (`appointment:read:own|all`, `appointment:write`) | [appointments.md](pages/appointments.md) |
| `/audit` | Workspace Audit Logs | Workspace Admin | Authenticated (`audit:read`) | [audit.md](pages/audit.md) |
| `/automations/[id]/edit` | Edit Automation | AI & Automation | Authenticated (`automation:manage`) | [automations_id_edit.md](pages/automations_id_edit.md) |
| `/automations/new` | Create Automation | AI & Automation | Authenticated (`automation:manage`) | [automations_new.md](pages/automations_new.md) |
| `/automations` | Automations & Run History | AI & Automation | Authenticated (`automation:manage` + `automations` plan feature) | [automations.md](pages/automations.md) |
| `/billing` | Subscription & Billing | Workspace Admin | Authenticated (`billing:manage`) | [billing.md](pages/billing.md) |
| `/campaigns/[id]` | Campaign Detail & Follow-ups | CRM & Messaging | Authenticated (`campaign:read`, `campaign:manage`) | [campaigns_id.md](pages/campaigns_id.md) |
| `/campaigns` | WhatsApp Broadcasts | CRM & Messaging | Authenticated (`campaign:read`, `campaign:manage`) | [campaigns.md](pages/campaigns.md) |
| `/dashboard` | Workspace Dashboard | CRM & Messaging | Authenticated workspace member | [dashboard.md](pages/dashboard.md) |
| `/emails` | Email Tracking & Suppressions | CRM & Messaging | Authenticated (`email:read:own|all`, `email:suppress:manage`) | [emails.md](pages/emails.md) |
| `/inbox` | Shared Omnichannel Inbox | CRM & Messaging | Authenticated (`conversation:read:own|all`, `conversation:reply`) | [inbox.md](pages/inbox.md) |
| `/integrations` | Integrations & Channels | Workspace Admin | Authenticated (`integration:manage`; Calendar personal) | [integrations.md](pages/integrations.md) |
| `/knowledge` | Knowledge Base | AI & Automation | Authenticated (`knowledge:manage`) | [knowledge.md](pages/knowledge.md) |
| `/leads/[id]` | Lead 360° Detail | CRM & Messaging | Authenticated (scoped to lead read/write) | [leads_id.md](pages/leads_id.md) |
| `/leads` | Leads Directory | CRM & Messaging | Authenticated (`lead:read:own` or `lead:read:all`) | [leads.md](pages/leads.md) |
| `/onboarding` | Workspace Onboarding | Workspace App | Authenticated workspace member | [onboarding.md](pages/onboarding.md) |
| `/pipeline` | Sales Pipeline | CRM & Messaging | Authenticated (`pipeline:manage` to configure) | [pipeline.md](pages/pipeline.md) |
| `/properties` | Property Inventory | CRM & Messaging | Authenticated (`property:read`, `property:manage`; pack module `properties`) | [properties.md](pages/properties.md) |
| `/reports` | Reports & Analytics | AI & Automation | Authenticated (`analytics:read:own|team|all`, `csv_export` feature) | [reports.md](pages/reports.md) |
| `/roles` | Roles & Permissions | Workspace Admin | Authenticated (`team:read`, `role:manage`) | [roles.md](pages/roles.md) |
| `/security` | Account & Workspace MFA | Workspace Admin | Authenticated (`settings:manage` for workspace policy) | [security.md](pages/security.md) |
| `/settings` | Workspace Settings | Workspace Admin | Authenticated (`settings:manage` for workspace panels) | [settings.md](pages/settings.md) |
| `/tasks` | Follow-Up Tasks | AI & Automation | Authenticated workspace member | [tasks.md](pages/tasks.md) |
| `/team` | Team Members & Invitations | Workspace Admin | Authenticated (`team:read`, `team:invite`, `team:manage`) | [team.md](pages/team.md) |
| `/usage` | Plan Consumption & Quotas | Workspace Admin | Authenticated (`usage:read`) | [usage.md](pages/usage.md) |
| `/webhooks` | Outbound Webhooks | Workspace Admin | Authenticated (`integration:manage` + `api_access` feature) | [webhooks.md](pages/webhooks.md) |
| `/accept-invite` | Accept Team Invitation | Auth & Public | Public (`?token=...`) | [accept-invite.md](pages/accept-invite.md) |
| `/auth/sso/callback` | SSO Callback | Auth & Public | Public | [auth_sso_callback.md](pages/auth_sso_callback.md) |
| `/forgot-password` | Forgot Password | Auth & Public | Public | [forgot-password.md](pages/forgot-password.md) |
| `/login` | Sign In | Auth & Public | Public (`?next=<path>`) | [login.md](pages/login.md) |
| `/register` | Create Workspace | Auth & Public | Public | [register.md](pages/register.md) |
| `/reset-password` | Reset Password | Auth & Public | Public (`?token=...`) | [reset-password.md](pages/reset-password.md) |
| `/verify-email` | Email Verification | Auth & Public | Public (`?token=...`) | [verify-email.md](pages/verify-email.md) |
| `/data-deletion` | Meta Data Deletion Status | Auth & Public | Public (`?code=...`) | [data-deletion.md](pages/data-deletion.md) |
| `/design/dashboard` | Design Preview: Dashboard | Design & Dev | Non-product static preview | [design_dashboard.md](pages/design_dashboard.md) |
| `/design/inbox` | Design Preview: Inbox | Design & Dev | Non-product static preview | [design_inbox.md](pages/design_inbox.md) |
| `/design/lead` | Design Preview: Lead Detail | Design & Dev | Non-product static preview | [design_lead.md](pages/design_lead.md) |
| `/design/pipeline` | Design Preview: Pipeline | Design & Dev | Non-product static preview | [design_pipeline.md](pages/design_pipeline.md) |
| `/dev-error` | Dev Error Trigger | Design & Dev | Development only (`notFound()` in prod) | [dev-error.md](pages/dev-error.md) |
| `/invoice/[id]` | Printable Tax Invoice | Auth & Public | Authenticated (`billing:manage`) | [invoice_id.md](pages/invoice_id.md) |
| `/p/[key]` | Customer Portal | Auth & Public | Public (OTP -> `lp_portal` cookie) | [p_key.md](pages/p_key.md) |
| `/p/claim/[token]` | Slot Rescue Claim | Auth & Public | Public (`?l=<leadId>`) | [p_claim_token.md](pages/p_claim_token.md) |
| `/` | Root Redirect | Auth & Public | Public | [root.md](pages/root.md) |
| `/platform/audit` | Platform Audit Log | Platform Console | Authenticated `PlatformAdmin` | [platform_audit.md](pages/platform_audit.md) |
| `/platform/deletions` | Platform Pending Deletions | Platform Console | Authenticated `PlatformAdmin` | [platform_deletions.md](pages/platform_deletions.md) |
| `/platform/health` | Platform Health Summary | Platform Console | Authenticated `PlatformAdmin` | [platform_health.md](pages/platform_health.md) |
| `/platform/login` | Platform Staff Login | Platform Console | Public (isolated staff auth) | [platform_login.md](pages/platform_login.md) |
| `/platform/ops` | Platform Ops & Alerts | Platform Console | Authenticated `PlatformAdmin` | [platform_ops.md](pages/platform_ops.md) |
| `/platform` | Platform Overview | Platform Console | Authenticated `PlatformAdmin` | [platform.md](pages/platform.md) |
| `/platform/plans` | Platform Plans & Entitlements | Platform Console | Authenticated `PlatformAdmin` | [platform_plans.md](pages/platform_plans.md) |
| `/platform/security` | Platform Staff MFA | Platform Console | Authenticated `PlatformAdmin` | [platform_security.md](pages/platform_security.md) |
| `/platform/tenants/[id]` | Platform Tenant Detail | Platform Console | Authenticated `PlatformAdmin` | [platform_tenants_id.md](pages/platform_tenants_id.md) |
| `/platform/tenants` | Platform Tenants Registry | Platform Console | Authenticated `PlatformAdmin` | [platform_tenants.md](pages/platform_tenants.md) |
