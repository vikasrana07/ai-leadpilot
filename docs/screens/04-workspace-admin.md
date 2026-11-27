# 04 — Workspace Admin & Settings Screens

This document covers team management, role-based access control, channel & calendar integrations, developer APIs/webhooks, billing & usage, audit logs, personal/workspace security, and general settings.

---

## `/team` — Team Members & Invitations

- **Route & Access**: `/team` (Requires `team:read`; inviting/mutating requires `team:invite` / `team:manage`)
- **What It Does**: Lists active and deactivated team members, pending invitations, and per-member lead workload, with actions to invite teammates, change roles, deactivate/reactivate, or reset MFA.
- **User Flow**:
  1. Click **Invite teammate**, enter email and select a role (loaded from `/roles`), and send a 7-day invitation link.
  2. Use the member action menu (`...`) to change a member's role, deactivate/reactivate access, or **Reset MFA** (requires a 5+ character audit reason).
  3. Resend or revoke pending invitations.
  4. **Permissions** (member menu): open `MemberPermissionsDialog` to grant or revoke individual permissions on top of the member's role. Overrides are resolved by `resolveEffectivePermissions` and applied on every request.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Team**.
  - **Outgoing**: Invited users receive an email link to `/accept-invite?token=...`; roles are configured in `/roles`.
- **Technical Reference**: `apps/web/app/(app)/team/page.tsx` · `GET /team/members`, `GET/POST /team/invitations`, `POST /team/members/:id/mfa-reset`, `GET/PUT /team/members/:id/permissions`, `GET /roles`

---

## `/roles` — Roles & Permissions

- **Route & Access**: `/roles` (Viewing requires `team:read`; creating/editing/deleting custom roles requires `role:manage`)
- **What It Does**: Displays system baseline roles (`owner`, `manager`, `agent`) and lets owners build custom roles with granular permission matrices.
- **User Flow**:
  1. Review each role card's description and assigned permissions.
  2. Click **Create custom role** (or **Edit** on a custom role) to open `RoleBuilderDialog` and toggle specific permissions.
  3. Delete unused custom roles with confirmation.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Roles & Permissions**.
  - **Outgoing**: Custom roles immediately appear in the role dropdown on `/team`.
- **Technical Reference**: `apps/web/app/(app)/roles/page.tsx` · `GET/POST/PATCH/DELETE /roles*`

---

## `/integrations` — Channels & Connectors

- **Route & Access**: `/integrations` (Channel/widget/SES/API key management requires `integration:manage`; Google Calendar card is shown to members for personal calendar sync)
- **What It Does**: Central hub for connecting lead capture and messaging channels:
  - **WhatsApp Business** (`WhatsappCard` — Embedded Signup via Facebook or manual Cloud API credentials, plus WhatsApp templates).
  - **Website Chat Widget** (`WidgetCard` — embeddable chat script & styling).
  - **Email / Amazon SES** (`SesCard` — outbound email sender configuration).
  - **Google Calendar** (`GoogleCalendarCard` — OAuth sync for appointments).
  - **Portal Email Parsing** (`PortalEmailCard` — enable a private webhook endpoint that turns 99acres / MagicBricks / Housing enquiry emails (direct JSON or Amazon SES/SNS) into leads; rotate key; recent parse log).
  - **Google Sheets** (`GoogleSheetsCard` — OAuth, pick a sheet, import new rows as leads, **Sync now**, disconnect).
  - **Messenger / Instagram** (`MetaSocialCard` — connect Meta pages so DMs land in `/inbox`).
  - **Lead Capture API** — quick API key creation and `curl` snippet for `POST /public/leads`.
- **User Flow**:
  1. Connect WhatsApp, configure the Web Widget, set up SES email, or link Google Calendar.
  2. Create a quick Lead Capture API key and copy the one-time secret from the modal.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Integrations**, or **Connect a channel** CTA in `/inbox`.
  - **Outgoing**: Connected channels feed `/inbox`, `/campaigns`, `/emails`, and `/appointments`.
- **Technical Reference**: `apps/web/app/(app)/integrations/page.tsx` · `GET/POST /channels*`, `GET/PUT /widget-config`, `GET/POST /integrations/google-calendar*`, `GET/POST/DELETE /api-keys`, `GET/PUT /integrations/portal-email*`, `POST /webhooks/portal-email/:key`, `GET/PUT/DELETE /integrations/google-sheets*`, Meta social admin and webhook routes

---

## `/api-keys` — Developer API Keys

- **Route & Access**: `/api-keys` (Requires `integration:manage`)
- **What It Does**: Full-featured scoped API key management for integrating external systems with LeadPilot's public REST API.
- **User Flow**:
  1. Click **Create API key**, provide a name, choose expiration (days), and select granular scopes (`leads:create`, `leads:read`, `leads:write`, `leads:delete`, `conversations:read`, `appointments:read`, `appointments:write`).
  2. Copy the generated key once from the confirmation dialog.
  3. Monitor `lastUsedAt` and `requestCount`, or revoke keys.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **API keys**.
  - **Outgoing**: Upgrade prompts (if scope requires a higher plan) link to `/billing`.
- **Technical Reference**: `apps/web/app/(app)/api-keys/page.tsx` · `GET/POST/DELETE /api-keys*`

---

## `/webhooks` — Outbound Webhooks

- **Route & Access**: `/webhooks` (Requires `integration:manage`)
- **What It Does**: Configures HTTPS webhook endpoints to receive signed real-time events, inspects delivery logs, sends test pings, redelivers failed payloads, and rotates signing secrets.
- **User Flow**:
  1. Click **Add endpoint**, enter an `https://` URL, optional description, and select subscribed `WEBHOOK_EVENTS`.
  2. Copy the one-time **signing secret** (`Secret` dialog) to verify webhook signatures.
  3. Open **Deliveries** on any endpoint to inspect HTTP status codes, latency, errors, and trigger **Redeliver** or **Send test**.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Webhooks**.
  - **Outgoing**: Terminal developer configuration screen.
- **Technical Reference**: `apps/web/app/(app)/webhooks/page.tsx` · `GET/POST/PATCH/DELETE /webhooks*`, `GET /webhooks/:id/deliveries`, `POST /webhooks/:id/test|rotate-secret`

---

## `/billing` — Subscription & Billing

- **Route & Access**: `/billing` (Requires `billing:manage`)
- **What It Does**: Manages the workspace's subscription plan, Razorpay checkout/plan changes/cancellations, Indian GST billing profile, and invoice history.
- **User Flow**:
  1. Review current plan status, trial days remaining, or grace-period alerts.
  2. Click **Billing details** to update legal name, 15-character GSTIN, state code, and address for GST invoices.
  3. Compare available plans and click **Subscribe** / **Upgrade** / **Downgrade** (opens Razorpay checkout) or **Cancel subscription**.
  4. View past invoices in the **Invoices** table.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Subscription & Billing**, **Manage plan** link on `/usage`, or upgrade prompts.
  - **Outgoing**: Clicking any invoice opens `/invoice/[id]` for printing/PDF.
- **Technical Reference**: `apps/web/app/(app)/billing/page.tsx` · `GET /billing/summary`, `GET/PUT /billing/profile`, `POST /billing/checkout|cancel`, `GET /billing/invoices`

---

## `/usage` — Plan Consumption & Quotas

- **Route & Access**: `/usage` (Requires `usage:read`)
- **What It Does**: Displays current-month consumption against plan limits across AI tokens, messages (inbound, AI, team, automated templates), leads, appointments, automation runs, active seats, and document storage.
- **User Flow**:
  1. Inspect progress bars for plan limits and AI token usage (warns at 80%, flags limit-reached).
  2. Review breakdowns for **AI assistant**, **Messages**, **Work**, and **Workspace**.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Usage**.
  - **Outgoing**: **Manage plan** -> `/billing`.
- **Technical Reference**: `apps/web/app/(app)/usage/page.tsx` · `GET /usage`

---

## `/audit` — Workspace Audit Logs

- **Route & Access**: `/audit` (Requires `audit:read`)
- **What It Does**: Provides a tamper-resistant, cursor-paginated log of sensitive workspace events (sign-ins, SSO logins/changes, invitations, role changes, workspace updates) with signed WORM export.
- **User Flow**:
  1. Filter events by action type (`All events`, `Sign-ins`, `SSO sign-ins`, `SSO changes`, `WORM exports`, `Invitations`, `Role changes`, `Workspace changes`).
  2. Load more entries via infinite pagination.
  3. Click **Signed WORM export** to download a SHA-256 hash-chained & HMAC-signed `.jsonl` archive.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Audit Logs**.
  - **Outgoing**: Downloads `.jsonl` file locally.
- **Technical Reference**: `apps/web/app/(app)/audit/page.tsx` · `GET /audit-logs`, `GET /audit-logs/export`

---

## `/security` — Account & Workspace MFA

- **Route & Access**: `/security` (All authenticated members; workspace-wide policy toggle requires `settings:manage`)
- **What It Does**: Lets every user enroll/disable TOTP two-step verification and view/regenerate recovery codes, and lets owners enforce MFA for the entire workspace.
- **User Flow**:
  1. **Personal MFA (`MfaPanel`)**: Scan QR code in an authenticator app, verify the 6-digit code, and save one-time recovery codes.
  2. **Workspace Policy** *(Owners)*: Toggle **Require for all members**. When enabled, members without MFA are held at `/security` until they enroll.
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Security** (or forced redirect when workspace requires MFA).
  - **Outgoing**: Once enrolled, members can access `/dashboard` and the rest of the workspace.
- **Technical Reference**: `apps/web/app/(app)/security/page.tsx` · `GET/POST /security/mfa*`, `GET/PUT /security/workspace`

---

## `/settings` — Workspace Settings

- **Route & Access**: `/settings` (Visible to all members; editing workspace-level panels requires `settings:manage`)
- **What It Does**: Multi-panel configuration page combining workspace profile, lead assignment, SLA response-time targets, canned responses, corporate SSO, personal theme, active sessions, vendor support access, and data privacy/retention.
- **User Flow**:
  1. **Business profile**: Edit name, email, phone, website, industry, timezone, currency, and address.
  2. **Assignment & Response-time target (SLA)**: Configure auto-assignment and first-response SLA alerts (in minutes) with 30-day breach stats.
  3. **Canned responses & SSO**: Manage quick-reply templates for `/inbox` and configure OIDC / SAML 2.0 Single Sign-On (`SsoConfigCard`).
  4. **Appearance & Active sessions**: Choose Light/Dark/System theme and sign out other active devices.
  5. **Support access & Workspace privacy**: Grant/revoke temporary vendor support access (`SupportAccessCard`), configure data retention, or request workspace deletion (`WorkspacePrivacy`).
- **Navigation & Direction**:
  - **Incoming**: Admin sidebar **Settings**.
  - **Outgoing**: Saving industry/profile refreshes workspace terminology across all screens.
- **Technical Reference**: `apps/web/app/(app)/settings/page.tsx` · `GET/PATCH /tenant`, `GET/PUT /sla`, `GET/DELETE /auth/sessions*`, plus sub-components for assignment, canned responses, SSO, support access, and privacy.
