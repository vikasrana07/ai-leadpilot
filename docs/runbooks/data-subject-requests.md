# Runbook: data-subject requests, retention and workspace deletion

Roles: LeadPilot is the **processor**; the workspace owner is the **fiduciary** for their leads' data. A person asking to see or erase their data should be directed to the business that holds it; LeadPilot staff act only on the owner's instruction.

## Meta (Facebook) data-deletion and deauthorize requests
LeadPilot's WhatsApp Embedded Signup app must answer Meta's callbacks (ADR 0012). Requests are recorded in `meta_data_requests` (platform-only; the Facebook user id is stored only as a SHA-256 hash). LeadPilot holds no Facebook profile data and nothing keyed to a Facebook user, so there is normally nothing to delete: review the pending rows (`SELECT kind, confirmation_code, status, received_at FROM meta_data_requests WHERE status = 'received' ORDER BY received_at`), check whether the person is a workspace owner who connected a number (they can disconnect it, or delete the workspace under Settings → Data), and when done run `UPDATE meta_data_requests SET status = 'completed', completed_at = now(), note = '...' WHERE confirmation_code = '...'`. The person sees the status at `/data-deletion?code=<code>`. Answer within the time Meta expects (check Meta's current requirement).

## A customer asks a business to export or erase their data (single lead)
1. Owner/manager opens the lead, **Privacy → Export data** (JSON) to answer an access request.
2. Owner opens **Privacy → Erase permanently**, records the request reference as the reason, types ERASE. Everything about the person is deleted (conversations, messages, notes, activity, appointments, tasks, consents, scores, provider payloads mentioning their phone; merged duplicates too). Only an audit entry (`privacy.lead_erased`, counts and reason) remains. **Irreversible.** Backups keep the data until they age out.
3. Verify (owner SQL): `SELECT count(*) FROM leads WHERE id = '<id>';` is 0; the audit entry exists.

## Retention
Settings → **Data retention** (owner/`settings:manage`). Defaults: raw webhook payloads 30 days, deleted leads purged after 30 days, closed conversations and audit log kept. Automation history is also purged (ADR-0010, ADR-0074): dry-run rows after 7 days, finished runs after 180 days, old unreferenced automation versions after 365 days (`RETENTION_AUTOMATION_*_DAYS`; per-workspace override via the API only). `QUEUED`/`RUNNING`/`WAITING` runs and the live version are never purged. Platform minimum 7 days (`RETENTION_MIN_DAYS`). The job runs once a day per workspace from the worker. To see what is due: *Preview* in the UI or `POST /privacy/retention/preview`. If a workspace has a legal hold, set its retention fields empty (keep) and leave a note in the ticket.
Check it ran: `SELECT created_at, metadata FROM audit_logs WHERE tenant_id = '<id>' AND action = 'privacy.retention_purged' ORDER BY created_at DESC LIMIT 5;` (no row = nothing was due). Check the worker is running (see worker-and-queues.md).

## Workspace export (customer asks for all their data, or before closing)
Owner: Settings → **Export your workspace data**. The worker prepares it within about a minute (or immediately after the next maintenance tick); the owner is notified; the file is available 7 days. Stuck export (`status` QUEUED/RUNNING for more than 15 minutes): `SELECT * FROM data_exports WHERE tenant_id = '<id>' ORDER BY created_at DESC;` and check the worker log for `Export … failed`; a RUNNING export older than 15 minutes is retried automatically; a FAILED one can be re-requested by the owner.

## Workspace deletion
1. Owner: Settings → **Delete this workspace** (reason, typed phrase, password). Read-only immediately; owners get an email. Cooling-off 14 days (`DELETION_COOLING_OFF_DAYS`).
2. Platform console → **Deletion requests** lists pending ones with the purge date. LeadPilot staff do **not** purge by hand; the worker does it after the date. To stop one (e.g. the request was fraudulent), ask the owner to cancel in Settings (or, with the owner's written instruction, `UPDATE tenant_deletion_requests SET status = 'CANCELED', canceled_at = now() WHERE tenant_id = '<id>' AND status = 'PENDING';` as the database owner, and note it in the incident log).
3. After the purge: the workspace, its users who belonged nowhere else, its files and its provider subscription are gone; **invoices and payments remain** (tax records) and `platform_audit_logs` has `platform.tenant_purged` (counts only). If the log says billing `failed`, cancel the Razorpay subscription manually.
4. A purge cannot be undone. Backups taken before the purge still contain the data until they expire: tell customers the backup retention period.
