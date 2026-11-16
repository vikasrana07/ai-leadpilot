# Incident response

## Severity
| Sev | Definition | Examples | Response |
|---|---|---|---|
| 1 | Platform down, or suspected cross-tenant data exposure / breach | API 5xx for all, `/health/ready` failing, a tenant sees another tenant's data | Immediately, all hands; start the [DPDP runbook](data-breach-dpdp.md) in parallel if personal data may be exposed |
| 2 | Major feature broken for many tenants | No WhatsApp inbound, AI not replying anywhere, billing webhooks failing, worker down | Within 30 min |
| 3 | Degraded or one tenant affected | Slow dashboard, one tenant's channel failing | Same business day |
| 4 | Cosmetic / question | | Backlog |

## First 15 minutes
1. **Declare** (name an incident lead, open a channel, note the start time).
2. **Scope**: is it one tenant, many, or all? Check `GET /health/ready` and the API/worker logs (every line carries `requestId`; tenant/user ids where known).
3. **Stop the bleeding** with the least destructive switch:
   - AI misbehaving or costing money: set `AI_KILL_SWITCH=true` and restart API+worker ([ai-incident.md](ai-incident.md)).
   - One abusive/compromised tenant: suspend it from the platform console ([tenant-support.md](tenant-support.md)).
   - Bad deploy: roll back the image (see `docs/deployment.md` rollback). Migrations are expand/contract, so the previous image should still run.
   - Possible breach: contain first (rotate secrets: `JWT_ACCESS_SECRET` invalidates all sessions; `PLATFORM_JWT_SECRET` the console), preserve logs, then assess.
4. **Triage by symptom**: workers/queues → [worker-and-queues.md](worker-and-queues.md); inbound/payment events → [webhooks.md](webhooks.md); money → [billing-incident.md](billing-incident.md); data loss → [database-backup-restore.md](database-backup-restore.md).
5. **Communicate**: internal update every 30 minutes (Sev 1/2). Customer status message when impact is confirmed: what is affected, what we are doing, next update time; never speculate on cause. Placeholder status channel: {{STATUS_PAGE_OR_CHANNEL}}.

## Useful evidence
- Platform actions: `platform_audit_logs`. Tenant actions: `audit_logs` (and the tenant's Audit page).
- Inbound webhooks: `webhook_events` (WhatsApp), `billing_events` (Razorpay).
- AI: `ai_runs` (status, tokens, trace with tool calls and guard violations).
- Jobs: `outbox_events`, `automation_runs`.

## After
Blameless write-up within 5 working days: timeline, impact (tenants, messages, money), root cause, what worked, actions with owners. File under `docs/decisions/` if it changes a design decision.
