# SLOs and alerts

**Status: proposed targets, measurement and alerting built (monitoring milestones 1-4).** Targets are tied to the performance budgets in the master prompt (B4). Alert rules and email delivery run inside the app for everything the health snapshot can measure (see "Implemented in the app" and `docs/monitoring.md`); the AWS-side alarms and the external probe are **examples and recipes only, never deployed** (`infrastructure/monitoring/`, `docs/runbooks/external-uptime-probe.md`). **No Sentry/OpenTelemetry is built.** Load-test results against these budgets belong in `PROGRESS.md` (Phase 7 verification), not here.

## SLOs
| # | SLI | Objective | Measurable today? |
|---|---|---|---|
| 1 | Availability: share of minutes where `GET /health/ready` succeeds (external probe) | 99.5% monthly (revisit after 3 months of data) | Only with an external uptime probe you configure; the endpoint exists |
| 2 | Dashboard load (`/analytics/*` responses) at 100k leads/tenant | p95 < 2 s | Yes: the `RequestDurationP95Ms` metric (`RouteGroup=analytics`, from the EMF lines, milestone 2) or the JSON access log; also by load test (`scripts/loadtest.mjs`) |
| 3 | Webhook ACK: WhatsApp `POST /webhooks/whatsapp/:key` | p95 < 1 s | Yes: `RequestDurationP95Ms` with `RouteGroup=webhook`, or the access log (`route=/webhooks/whatsapp/:key`); also by load test |
| 4 | AI turn latency (model + tools, from `ai_runs.latency_ms`) | p95 < 8 s (customer-visible reply also includes ~1.2 s debounce and WhatsApp send; track end to end separately) | Yes: gauge `AiLatencyP95Ms24h` (from `ops_health_snapshot()`) or the query below |
| 5 | Outbox lag: age of oldest `pending`/`processing` outbox row | < 60 s for 99% of minutes | Yes: gauge `OutboxOldestPendingSeconds` (once a minute) |
| 6 | Automation run success (not counting intended skips) | > 99% of runs end SUCCEEDED/SKIPPED, none stuck | Yes: counters `JobOutcome` (automation) and gauges `RunsStuckRunning`, `RunsQueuedOld`, `RunsWaitingOverdue` |
| 7 | Billing webhook health: failed/unprocessed `billing_events` | 0 older than 15 min | Yes: gauge `BillingEventsNeedingAttention` |
| 8 | Server errors | 5xx < 0.5% of requests | Yes: `RequestCount` by `StatusClass` (5xx / total) from the EMF lines; in CloudWatch via a metric-math expression |

## Where each SLO is measured today
| # | SLI | In-app metric (EMF lines) | In-app alert | AWS alarm (example template) | Needs the external probe |
|---|---|---|---|---|---|
| 1 | Availability | none (a dead app cannot report) | none | `*-alb-api-no-healthy-hosts` (partial) | **Yes: the only real measure** |
| 2 | Dashboard p95 < 2 s | `RequestDurationP95Ms` (`RouteGroup=analytics`) | none | `*-analytics-p95` | no |
| 3 | Webhook ACK p95 < 1 s | `RequestDurationP95Ms` (`RouteGroup=webhook`) | none | `*-webhook-ack-p95` | no |
| 4 | AI turn p95 < 8 s | gauge `AiLatencyP95Ms24h` | `ai_failure_rate` (failures, not latency) | none | no (never measured against a real model) |
| 5 | Outbox lag < 60 s | gauge `OutboxOldestPendingSeconds` | `outbox_lag` (> 120 s for 5 min) | none | no |
| 6 | Automation success > 99%, none stuck | `JobOutcome`, `RunsStuckRunning`, `RunsQueuedOld`, `RunsWaitingOverdue` | `automation_runs_stuck`, `automation_waits_overdue` | `*-automation-job-failures` | no |
| 7 | Billing events healthy | gauge `BillingEventsNeedingAttention` | `billing_events_attention` | `*-billing-job-failures` | no |
| 8 | 5xx < 0.5% | `RequestCount` by `StatusClass` | none | `*-api-5xx-rate`, `*-alb-api-target-5xx` | no |

Notes: the 99.5% availability objective needs one minute-by-minute record, which only the probe provides. p95 values are per-instance estimates from fixed buckets (CloudWatch cannot merge them), so the example alarms use the worst instance. The SLO table on the console's Ops status page shows current values for 4 to 7 and says where 1 to 3 and 8 are measured.

## Queries (run as owner; schedule them in whatever cron/monitor you use)
```sql
-- SLI 5: outbox lag in seconds (alert if > 120)
SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0) AS oldest_seconds, count(*) AS rows
FROM outbox_events WHERE status IN ('pending','processing');
-- failed outbox rows (alert if > 0)
SELECT count(*) FROM outbox_events WHERE status='failed';
-- SLI 6: runs last hour by status; stuck RUNNING
SELECT status, count(*) FROM automation_runs WHERE created_at > now() - interval '1 hour' GROUP BY status;
SELECT count(*) FROM automation_runs WHERE status='RUNNING' AND started_at < now() - interval '15 minutes';
SELECT count(*) FROM automation_runs WHERE status='QUEUED' AND created_at < now() - interval '10 minutes';
-- SLI 4: AI latency percentiles, last 24h (completed runs)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) p95, count(*)
FROM ai_runs WHERE created_at > now() - interval '24 hours' AND status='COMPLETED';
-- AI failures / plan blocks / cap hits last hour
SELECT status, trace->>'outcome' AS outcome, count(*) FROM ai_runs WHERE created_at > now() - interval '1 hour' GROUP BY 1,2;
-- SLI 7: billing events needing attention
SELECT count(*) FROM billing_events WHERE status IN ('failed','received') AND received_at < now() - interval '15 minutes';
-- WhatsApp deliveries left unprocessed (possible lost messages)
SELECT count(*) FROM webhook_events WHERE status='received' AND created_at < now() - interval '5 minutes';
-- Failed outbound messages last hour
SELECT count(*) FROM messages WHERE direction='OUTBOUND' AND status='FAILED' AND created_at > now() - interval '1 hour';
```
Queue depth (Redis): `redis-cli ZCARD leadpilot:automation-runs:failed` and `LLEN leadpilot:automation-runs:wait` (key prefix = `QUEUE_PREFIX`).

## Implemented in the app (milestone 3)
Evaluated once a minute against `ops_health_snapshot()` and the worker heartbeats, with email to platform admins (`ALERTS_ENABLED=true`). Thresholds in `apps/api/src/ops/alert-rules.ts`; live state on the console's **Ops status** page.

| Proposed alert below | Rule key |
|---|---|
| Worker not running | `worker_not_running` (no heartbeat, 3 min) and `outbox_lag` (oldest pending over 120 s, 5 min); `snapshot_stale` when the maintenance job itself stops |
| Outbox failures | `outbox_failed` |
| Automation stuck | `automation_runs_stuck` |
| Waits overdue | `automation_waits_overdue` |
| Billing webhook failing | `billing_events_attention` |
| WhatsApp deliveries unprocessed | `whatsapp_unprocessed` |
| AI error rate | `ai_failure_rate` (needs at least 10 runs in 15 min) |
| (new) | `outbound_messages_failing`, `webhook_deliveries_failing` |

**Still external (not in the app):** API down (probe `/health/ready` from outside; an app that is down cannot email), Database and Redis resource alarms (CloudWatch), Backups, AI cost spike (needs a 7-day baseline), Auth abuse (audit log).

## Proposed alerts
| Alert | Condition | Severity | Who |
|---|---|---|---|
| API down | external probe of `/health/ready` fails 3 consecutive minutes | Sev 1 | On-call (page) |
| Worker not running | outbox lag > 120 s for 5 min, or no ECS worker task running | Sev 2 | On-call (page) |
| Outbox failures | `failed` outbox rows > 0 | Sev 3 | Engineering channel |
| Automation stuck | RUNNING > 15 min or QUEUED > 10 min | Sev 3 | Engineering channel |
| Waits overdue | `automation_runs` WAITING with `resume_at` more than 15 min in the past (query in [worker-and-queues](runbooks/worker-and-queues.md)) | Sev 2 | On-call (the scanner is not running) |
| Billing webhook failing | `billing_events` failed/received > 15 min, or Razorpay dashboard shows failing endpoint | Sev 2 | On-call |
| WhatsApp deliveries unprocessed | `webhook_events` received > 5 min > 0 | Sev 2 | On-call |
| AI error rate | > 20% of `ai_runs` FAILED in 15 min | Sev 2 | On-call; consider `AI_KILL_SWITCH` |
| AI cost spike | tokens in last hour > 3x trailing 7-day hourly average | Sev 3 | Engineering; check [ai-incident](runbooks/ai-incident.md) |
| Database | RDS CPU > 80% 10 min, free storage < 20%, connections > 80% (CloudWatch) | Sev 2 | On-call |
| Redis | ElastiCache unavailable / memory > 80% | Sev 2 | On-call |
| Backups | no automated backup in last 26 h; restore drill older than 90 days | Sev 3 | Owner |
| Auth abuse | spike of `auth.login_failed` in `audit_logs` | Sev 3 | Security contact |

## Error-budget policy (proposal)
Availability budget at 99.5% = about 3.6 hours/month. If more than 50% is burned in a month, freeze feature releases except fixes until the cause has a corrective action; if 100% burned, only reliability work until the next month. Every Sev 1/2 gets a written review.

## Gaps (honest list)
- **Never run against AWS.** The CloudWatch template is an example that was not deployed or validated by `cfn-lint`/AWS; real CloudWatch has not read the EMF lines; costs were not priced for any region.
- **Availability (SLO 1) is unmeasured until an external probe exists.** `docs/runbooks/external-uptime-probe.md` and `scripts/probe-health.mjs` are ready; no probe is configured because there is nothing deployed.
- **An app that is down cannot email.** In-app alerts cover a partly broken system; the probe and the AWS alarms cover a dead one.
- **Not covered at all:** AI cost spikes (needs a 7-day baseline), login-abuse spikes (audit log), backups age and restore-drill age, per-workspace health. Sentry, OpenTelemetry and log search beyond CloudWatch Logs Insights are not built.
- **Latency SLOs use per-instance p95 estimates**, not exact percentiles across instances.
- AI latency (SLO 4) has never been measured against a real model, and customer-visible AI latency (inbound webhook to outbound send) is not recorded as one number.
- Real inbox delivery of alert email and `worker_not_running` with a real stopped worker are unverified (`docs/monitoring.md`, "what is verified and what is not").
- `/health/ready` checks both the database and Redis (Phase 7); it is only useful with the external probe calling it.
