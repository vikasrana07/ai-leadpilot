# Runbooks

Operational procedures for LeadPilot. Each is written against the real code, tables and endpoints. **None has been exercised in a production incident**; the database restore has a "Drill record" section to be filled after the drill.

| Runbook | Use when |
|---|---|
| [incident-response.md](incident-response.md) | Anything is on fire: severity, first 15 minutes, communications |
| [database-backup-restore.md](database-backup-restore.md) | Data loss, bad migration, restore drill |
| [worker-and-queues.md](worker-and-queues.md) | Reminders/automations/notifications not happening; outbox or queue backlog; Redis down |
| [webhooks.md](webhooks.md) | WhatsApp messages not arriving; Razorpay events failing; signature errors; outbound messages failing; customer webhook deliveries failing |
| [ai-incident.md](ai-incident.md) | AI says something wrong, cost runaway, prompt-injection report, LLM outage |
| [billing-incident.md](billing-incident.md) | Wrong plan, missing/duplicate invoice, webhook outage, lapsed customer disputes |
| [data-breach-dpdp.md](data-breach-dpdp.md) | Suspected personal-data breach (needs legal review) |
| [external-uptime-probe.md](external-uptime-probe.md) | Setting up or testing the outside check of `/health/ready` (the only thing that notices a fully dead app) |
| [tenant-support.md](tenant-support.md) | Suspend/reactivate, read-only workspaces, console actions |
| [data-subject-requests.md](data-subject-requests.md) | Lead export/erasure, retention, workspace export and deletion |

Conventions: SQL below is run as the schema **owner** role (`DATABASE_OWNER_URL`) because the app role is subject to row-level security and sees no tenant rows without a tenant context. Replace `<tenant-id>` etc. Prefer read-only queries first; every write is called out.
Health endpoints: `GET /health` (liveness), `GET /health/ready` (database and Redis). Alerts and what to check first: the "Alert-to-runbook map" in [../monitoring.md](../monitoring.md).
