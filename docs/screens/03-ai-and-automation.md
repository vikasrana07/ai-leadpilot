# 03 — AI, Scheduling & Automation Screens

This document covers AI assistant configuration, the RAG knowledge base, appointment scheduling, task management, visual workflow automations, and analytics reports.

---

## `/ai-assistant` — AI Assistant & Lead Scoring

- **Route & Access**: `/ai-assistant` (Requires `ai:configure`)
- **What It Does**: Configures how the AI assistant greets, answers, qualifies, and hands over conversations, defines lead scoring rules, and displays monthly token usage and recent AI runs.
- **User Flow**:
  1. Monitor the **AI usage this month** progress bar at the top (shows token cap, 80% warning, or exceeded/kill-switch notices).
  2. **Assistant tab**: Toggle AI **On/Off**, set name/business identity/description, pick **Languages** (`English`, `Hindi`, `Hinglish`) and **Tone**, edit welcome message, extra instructions, and disclosure text, enable/disable **Allowed tools**, and configure **Handover rules** (keywords, price negotiation, complaints, fallback message, and team working hours).
  3. **Lead scoring tab**: Configure qualification rules that determine Hot/Warm/Cold scores.
  4. **Activity & usage tab**: Inspect recent AI conversation runs and outcomes.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **AI Assistant**.
  - **Outgoing**: Works alongside `/knowledge` (answers from uploaded docs) and `/inbox` (handles live chats until handover).
- **Technical Reference**: `apps/web/app/(app)/ai-assistant/page.tsx` · `GET/PUT /ai/assistant`, `GET/PUT /scoring/rules`, `GET /ai/usage`, `GET /ai/runs`

---

## `/knowledge` — Knowledge Base

- **Route & Access**: `/knowledge` (Requires `knowledge:manage`)
- **What It Does**: Uploads, virus-scans, chunks, and indexes brochures, FAQs, policies, and price lists (`PDF`, `DOCX`, `TXT`, `MD`, `CSV` up to 10 MB) so the AI assistant answers accurately from your documents.
- **User Flow**:
  1. **Upload**: Drag-and-drop files or click **Choose files**. Documents automatically poll until status changes from `PENDING`/`PROCESSING` to `READY` (or `FAILED`).
  2. **Manage**: Click a document title to preview its extracted passages, click **Reprocess** if needed, or **Delete** it.
  3. **Test Search**: Enter a customer-style question in **Test what the assistant can find** and click **Search** to see matching passages and similarity scores.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Knowledge Base**.
  - **Outgoing**: Directly feeds `/ai-assistant` responses in `/inbox`.
- **Technical Reference**: `apps/web/app/(app)/knowledge/page.tsx` · `GET/POST /knowledge/documents`, `GET/DELETE /knowledge/documents/:id`, `POST /knowledge/documents/:id/reprocess`, `POST /knowledge/search`

---

## `/appointments` — Appointments & Availability

- **Route & Access**: `/appointments` (All authenticated members; team-wide view requires `appointment:read:all`)
- **What It Does**: Calendar and list view for booking, rescheduling, confirming, completing, cancelling, and recovering no-shows for visits/calls/meetings, plus configuring weekly availability rules and date exceptions.
- **User Flow**:
  1. Toggle between **Calendar** (weekly grid) and **List** views, and navigate weeks.
  2. **Book / Reschedule**: Click **New appointment** (or reschedule an existing one), pick a lead, agent, service type, duration, and choose an open time slot from `SlotPicker`.
  3. **Update Status**: Confirm pending bookings, mark completed, cancel, or mark **No-show** (triggers `NoShowRecoveryDialog`).
  4. **Availability**: Open the **Availability** settings dialog to set weekly working hours and date-specific exceptions.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Appointments**, or deep-linked from `/leads/[id]` (`?leadId=...`).
  - **Outgoing**: Links to lead profiles (`/leads/[id]`); syncs with Google Calendar if connected in `/integrations`.
- **Technical Reference**: `apps/web/app/(app)/appointments/page.tsx` · `GET/POST /appointments`, `GET /appointments/slots`, `POST /appointments/:id/confirm|complete|cancel|no-show|reschedule`, `GET/PUT /appointments/availability`

---

## `/tasks` — Follow-Up Tasks

- **Route & Access**: `/tasks` (All authenticated members)
- **What It Does**: Personal and team to-do list for follow-ups created manually, by teammates, or by automations.
- **User Flow**:
  1. Filter tasks by **Mine vs All**, status tabs (`OPEN`, `TODAY`, `OVERDUE`, `DONE`, `ALL`), assignee, search text, and sort order.
  2. **Create or Edit**: Click **New task** (or edit icon) to open `TaskDrawer` and set title, due date/time, assignee, and linked lead.
  3. **Complete / Delete**: Check off tasks as done or delete them with confirmation.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Tasks**.
  - **Outgoing**: Linked lead badges navigate to `/leads/[id]`.
- **Technical Reference**: `apps/web/app/(app)/tasks/page.tsx` · Generated client `useTasksControllerList`, `tasksControllerUpdate`, `useTasksControllerRemove` (`/tasks*`)

---

## `/automations` — Automations List, Templates & Run History

- **Route & Access**: `/automations` (Requires `automation:manage` + `automations` plan feature)
- **What It Does**: Manages event-driven workflows (triggers -> branches/waits -> actions), provides industry-tailored templates, runs dry-run tests, and displays live execution history.
- **User Flow**:
  1. **My automations tab**: View each automation's trigger, action chain, missing WhatsApp template warnings, and 7-day run stats. Toggle **Turn on / Turn off**, click **Test** (`DryRunDialog` against a real lead without sending anything), **Edit**, or **Delete**.
  2. **Templates tab**: Browse industry templates; click **Add** (installs switched off) or **Customize** (installs and opens the editor).
  3. **Run history tab**: Polls every 8s; filter by status (`SUCCEEDED`, `FAILED`, `SKIPPED`, `DRY_RUN`, `QUEUED`, `WAITING`), expand step logs, click **Retry failed steps**, or click **View on canvas**.
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Automations**.
  - **Outgoing**:
    - **New automation** -> `/automations/new`.
    - **Edit** or **Customize** -> `/automations/[id]/edit`.
    - **View on canvas** (from Run history) -> `/automations/[id]/edit?run=<runId>`.
- **Technical Reference**: `apps/web/app/(app)/automations/page.tsx` · `GET /automations`, `GET /automations/templates`, `POST /automations/from-template`, `POST /automations/:id/enable|dry-run`, `GET /automations/runs`, `POST /automations/runs/:id/retry`

---

## `/automations/new` & `/automations/[id]/edit` — Automation Builder

- **Route & Access**: `/automations/new` and `/automations/[id]/edit` (Requires `automation:manage`; supports `?run=<runId>` read-only overlay)
- **What It Does**: Dual-mode workflow editor sharing one underlying graph: **Outline** (keyboard/screen-reader friendly list) and **Canvas** (`@xyflow/react` visual flowchart, read-only on phones), with live validation, plain-English summary, undo/redo, draft recovery, and dry-run testing.
- **User Flow**:
  1. Set the automation **Name**, **Description**, and **Cooldown (minutes)**.
  2. Choose a **Trigger** (e.g., lead created, appointment upcoming, lead quiet, customer message) and add **Actions**, **Branches** (If / Otherwise), or **Waits** (pause until reply or timeout).
  3. Fix any validation badges, click **Save**, click **Test** (dry-run on a lead), and toggle the automation **On**.
  4. When opened via `?run=<runId>`, the canvas overlays which path and nodes executed in that historical run.
- **Navigation & Direction**:
  - **Incoming**: **New automation**, **Edit**, **Customize**, or **View on canvas** from `/automations`.
  - **Outgoing**: Back to `/automations` (with unsaved-changes guard).
- **Technical Reference**: `apps/web/app/(app)/automations/new/page.tsx`, `apps/web/app/(app)/automations/[id]/edit/page.tsx`, `apps/web/components/automation-builder/automation-editor.tsx` · `GET/POST/PUT /automations*`, `POST /automations/validate`, `POST /automations/:id/dry-run`

---

## `/reports` — Reports & Analytics

- **Route & Access**: `/reports` (Requires `analytics:read:own`; manager-only tabs require `analytics:read:all` or `analytics:read:team`; CSV export requires `csv_export` plan feature)
- **What It Does**: Provides interactive charts, summary metrics, and breakdown tables across 7 report domains: `Acquisition`, `Funnel`, `Agents`, `Response time`, `Appointments`, `AI`, and `Automations`.
- **User Flow**:
  1. Select a **Report tab** (`Acquisition`, `Funnel`, `Agents`, `Response time`, `Appointments`, `AI`, `Automations`).
  2. Pick a **Date range** (or custom start/end dates).
  3. Review KPI summary cards, Recharts area/bar charts, and data tables.
  4. Click **Export CSV** on any table (if enabled on the workspace's plan).
- **Navigation & Direction**:
  - **Incoming**: Sidebar **Reports & Analytics**.
  - **Outgoing**: Terminal analytics view with CSV file download.
- **Technical Reference**: `apps/web/app/(app)/reports/page.tsx` · `GET /reports/:key`, `GET /billing/summary`
