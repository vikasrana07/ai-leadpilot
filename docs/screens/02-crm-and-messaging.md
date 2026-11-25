# 02 — CRM & Messaging Screens

This document covers the daily sales workspace: executive KPIs, lead management, pipeline Kanban, omnichannel chat inbox, email tracking, WhatsApp broadcasts, and property inventory.

---

## `/dashboard` — Workspace Dashboard

- **Route & Access**: `/dashboard` (All authenticated workspace members)
- **What It Does**: Gives an immediate pulse on lead volume, conversion rates, pipeline distribution, hot leads needing attention, upcoming follow-ups, and lead sources.
- **User Flow**:
  1. If onboarding is incomplete, a **Finish setting up** card appears at the top with a progress checklist.
  2. Filter metrics using the **Date range** pills (`Today`, `Yesterday`, `7 days`, `30 days`, `This month`, or `Custom` date pickers).
  3. Review 6 KPI cards (`Total leads`, `New leads`, `Qualified`, `Hot leads`, `Converted`, `Conversion rate`), **Lead acquisition** area chart, **Pipeline** horizontal bar chart, **Hot leads**, **Upcoming follow-ups**, and **Lead sources** table.
  4. Click **Add lead** (if permitted) to open the quick-create lead dialog directly from the dashboard.
- **Navigation & Direction**:
  - **Incoming**: Default landing screen after `/login`, `/auth/sso/callback`, `/accept-invite`, `/onboarding`, or sidebar **Dashboard**.
  - **Outgoing**:
    - **Continue setup** -> `/onboarding`.
    - Click any lead in **Hot leads** or **Upcoming follow-ups** -> `/leads/[id]`.
- **Technical Reference**: `apps/web/app/(app)/dashboard/page.tsx` · `GET /analytics/overview`, `GET /tenant/onboarding`

---

## `/leads` — Leads Directory

- **Route & Access**: `/leads` (All members; row-level scoped to own or all leads based on `lead:read:all` vs `lead:read:own`)
- **What It Does**: Searchable, filterable, sortable, and customizable data table of all leads/enquiries/customers, with CSV import/export and bulk actions.
- **User Flow**:
  1. **Search & Filter**: Use the search bar (300ms debounce), quick view tabs, and multi-select filters (`Stage`, `Temperature`, `Assigned`, `Source`, `Kind`, `Overdue`).
  2. **Customize Table**: Toggle visible columns, pin columns, reorder columns, and adjust row density (`useTablePreferences`).
  3. **Add or Import**: Click **Add lead** to create one manually, or **Import CSV** to bulk-upload leads.
  4. **Bulk Actions**: Select checkboxes to bulk-assign owners, move stages, add/remove tags, or delete leads.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Leads**, or **See all** link on a truncated `/pipeline` column (`/leads?stageId=...`).
  - **Outgoing**:
    - Click any lead name -> `/leads/[id]`.
    - Row quick-actions can jump to chat/schedule or trigger dialogs.
- **Technical Reference**: `apps/web/app/(app)/leads/page.tsx` · `GET /leads`, `POST /leads/bulk`, `POST /leads/import`, `GET /leads/export`

---

## `/leads/[id]` — Lead 360° Detail

- **Route & Access**: `/leads/[id]` (All members with read access to that lead; mutations respect `l.canWrite`, `lead:write:all`, `lead:delete`)
- **What It Does**: Complete single-lead workspace showing contact info, stage, temperature, AI lead score & override, custom fields, activity timeline, internal notes, tags, file attachments, email composer, and privacy controls.
- **User Flow**:
  1. **Update Stage or Owner**: Change the pipeline stage dropdown (selecting a `LOST` stage prompts for a lost reason & note) or reassign the owner.
  2. **Edit Profile**: Click **Edit** to update name, phone, email, budget, location, interest, timeline, next follow-up, requirements, and custom fields.
  3. **Communicate & Log**: Switch between **Activity** timeline and **Notes** tabs; add internal notes, tags, or virus-scanned file attachments (`LeadAttachmentsCard`, up to 10 MB); click **Send email** to open the tracked email composer (with optional follow-up templates pre-filled from lead, agent, and workspace context).
  4. **AI Score & Dedupe**: Inspect or override the AI qualification score (`ScoreCard`), or click **Merge duplicates** (`lead:write:all`) to combine duplicate records (re-parenting attachments to the survivor).
  5. **Privacy / Delete**: Use the privacy menu (consent/export/erasure) or delete icon (`lead:delete`).
- **Navigation & Direction**:
  - **Incoming**: `/leads` table row, `/dashboard` hot leads/follow-ups, `/pipeline` card title, `/inbox` details panel, `/tasks` linked lead, or App Shell `+` Quick Create.
  - **Outgoing**:
    - Breadcrumb **Leads** or **Back to leads** -> `/leads`.
    - Sent emails are tracked in `/emails`.
- **Technical Reference**: `apps/web/app/(app)/leads/[id]/page.tsx` · `GET/PATCH/DELETE /leads/:id`, `POST /leads/:id/stage`, `GET/POST /leads/:id/notes`, `GET /leads/:id/activity`, `PUT /leads/:id/tags`, `GET/POST /leads/:id/attachments`, `GET /leads/:id/attachments/:attachmentId/download`, `DELETE /leads/:id/attachments/:attachmentId`, `GET /emails/templates`, `POST /emails/send`

---

## `/pipeline` — Sales Pipeline (Kanban)

- **Route & Access**: `/pipeline` (All members; **Configure** button requires `pipeline:manage`)
- **What It Does**: Visual Kanban board grouping leads by pipeline stage (`OPEN`, `WON`, `LOST`) with optimistic drag-and-drop transitions.
- **User Flow**:
  1. Filter the board by **Assigned to** (`Everyone`, `Mine`, `Unassigned`, or specific team member) and **Temperature** (`Hot`, `Warm`, `Cold`).
  2. **Move a Lead**: Drag a card to another stage column, or click the **Move** menu icon on a card and pick the target stage.
  3. **Mark Lost**: Moving to a `LOST` stage opens a modal requiring a lost reason and optional note.
  4. **Configure Stages**: Owners/managers (`pipeline:manage`) click **Configure** to customize pipeline stages and lost reasons.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Sales Pipeline**.
  - **Outgoing**:
    - Click a card's lead name -> `/leads/[id]`.
    - **See all** at the bottom of a full column -> `/leads?stageId=<id>`.
- **Technical Reference**: `apps/web/app/(app)/pipeline/page.tsx` · `GET /pipeline/board`, `POST /leads/:id/stage`

---

## `/inbox` — Shared Omnichannel Inbox

- **Route & Access**: `/inbox` (Requires `conversation:read:own`; `Unassigned` queue requires `conversation:read:all`; reply/close requires `conversation:reply`)
- **What It Does**: 3-pane real-time messaging workspace for **WhatsApp** and **Website Chat** conversations, supporting AI-to-human handover, internal notes, canned responses, WhatsApp 24-hour window & template sending, and a customer details sidebar.
- **User Flow**:
  1. **Pick a Queue & Channel**: Filter by queue (`All open`, `Mine`, `Unassigned`, `Unread`, `AI handling`, `Closed`), channel (`All channels`, `WhatsApp`, `Website chat`), or search by name/phone/email.
  2. **Read & Reply**: Select a conversation (`?c=<id>`). Opening an unread thread automatically marks it read. Reply in the thread, take over from AI (`Team` vs `AI handling`), or click **Close** / **Reopen**.
  3. **Inspect Customer**: View or edit lead details, tags, and consent in the right-hand **Customer details** panel (or drawer on smaller screens).
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Inbox**.
  - **Outgoing**:
    - Empty state CTA **Connect a channel** (`integration:manage`) -> `/integrations`.
    - Lead links inside `DetailsPanel` -> `/leads/[id]`.
- **Technical Reference**: `apps/web/app/(app)/inbox/page.tsx` · `GET /conversations`, `GET /conversations/:id`, `POST /conversations/:id/read`, `POST /conversations/:id/close|reopen`, `GET /realtime/stream`

---

## `/emails` — Email Tracking & Suppressions

- **Route & Access**: `/emails` (Requires `email:read:own`; managing suppressions requires `email:suppress:manage`)
- **What It Does**: Monitors outbound email delivery and engagement (`SENT`, `DELIVERED`, `OPENED`, `CLICKED`, `BOUNCED`, `COMPLAINED`, `SUPPRESSED`) and manages the email suppression list.
- **User Flow**:
  1. Review top-level engagement stats.
  2. Switch between **Tracked Emails** and **Suppression List** tabs, using search and status filters.
  3. Click an email row to open the audit drawer showing delivery & engagement event history.
  4. On the **Suppression List** tab (`email:suppress:manage`), manually add a suppressed address (`MANUAL`, `HARD_BOUNCE`, `COMPLAINT`) or unsuppress an address.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Email Tracking**.
  - **Outgoing**: Links to associated leads (`/leads/[id]`); email sending itself happens from `/leads/[id]` or `/integrations` (SES setup).
- **Technical Reference**: `apps/web/app/(app)/emails/page.tsx` · `GET /emails/stats`, `GET /emails`, `GET /emails/:id`, `GET/POST/DELETE /emails/suppressions`

---

## `/campaigns` — WhatsApp Broadcasts

- **Route & Access**: `/campaigns` (Requires `campaign:read`)
- **What It Does**: Lists WhatsApp broadcast campaigns with aggregate KPIs (Total Sent, Delivery Rate, Read Rate, Opt-outs) and lets teams create, launch, or cancel bulk template campaigns.
- **User Flow**:
  1. Filter campaigns by status (`ALL`, `RUNNING`, `SCHEDULED`, `COMPLETED`, `DRAFT`, `CANCELLED`).
  2. Click **New Campaign** to open the creation wizard (select channel, approved WhatsApp template, template parameters, target lead segment with audience preview, and immediate/scheduled send).
  3. Launch `DRAFT` campaigns or cancel `RUNNING` / `SCHEDULED` campaigns from the list.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Broadcasts**.
  - **Outgoing**: Click any campaign -> `/campaigns/[id]`.
- **Technical Reference**: `apps/web/app/(app)/campaigns/page.tsx` · `GET /campaigns`, `POST /campaigns`, `POST /campaigns/:id/launch|cancel`, `GET /whatsapp/templates`

---

## `/campaigns/[id]` — Campaign Detail & Follow-ups

- **Route & Access**: `/campaigns/[id]` (Requires `campaign:read`)
- **What It Does**: Shows delivery/read/reply gauges, WhatsApp message preview, per-recipient delivery status table, failed-recipient retry, and cohort follow-up creation.
- **User Flow**:
  1. Inspect delivery, read, and reply rates alongside the rendered WhatsApp template preview.
  2. Search or filter the **Recipients** table by status.
  3. **Actions**: Launch a draft, cancel a running campaign, **Retry failed** recipients, or launch a **Follow-up campaign** targeting a specific cohort (e.g., `READ_NO_REPLY`).
- **Navigation & Direction**:
  - **Incoming**: Campaign row on `/campaigns`, or parent/follow-up campaign badge link.
  - **Outgoing**:
    - **Back to Broadcast Campaigns** -> `/campaigns`.
    - Recipient lead links -> `/leads/[id]`.
- **Technical Reference**: `apps/web/app/(app)/campaigns/[id]/page.tsx` · `GET /campaigns/:id`, `GET /campaigns/:id/recipients`, `POST /campaigns/:id/retry-failed`

---

## `/properties` — Property Inventory

- **Route & Access**: `/properties` (Requires `property:read`; hidden from sidebar unless the workspace's industry pack enables the `properties` module, e.g., Real Estate)
- **What It Does**: Manages real estate inventory (projects, unit labels, property types, bedrooms, area, price in INR, location, and `AVAILABLE` / `HELD` / `SOLD` status) with CSV import.
- **User Flow**:
  1. Search, filter by status/project, and customize table columns/density.
  2. Click **Add property** or edit an existing row via the Property Dialog.
  3. Click **Import CSV** to bulk-import property listings, or delete listings with confirmation.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Properties** (when industry pack enables `properties`).
  - **Outgoing**: Self-contained inventory management screen; properties can be referenced by the AI assistant and leads.
- **Technical Reference**: `apps/web/app/(app)/properties/page.tsx` · `GET/POST/PATCH/DELETE /properties`, `POST /properties/import`
