# SLOs and alerts

**Status: proposed.** Targets are tied to the performance budgets in the master prompt (B4). Only some SLIs are measurable today. Nothing below pages anyone yet: **no metrics endpoint, OpenTelemetry, Sentry or alerting is built** (see "Gaps"). Load-test results against these budgets belong in `PROGRESS.md` (Phase 7 verification), not here.

## SLOs
| # | SLI | Objective | Measurable today? |
|---|---|---|---|
| 1 | Availability: share of minutes where `GET /health/ready` succeeds (external probe) | 99.5% monthly (revisit after 3 months of data) | Only with an external uptime probe you configure; the endpoint exists |
| 2 | Dashboard load (`/analytics/*` responses) at 100k leads/tenant | p95 < 2 s | Yes, from the JSON access log (`route` + `durationMs`, `ACCESS_LOG`, on by default in production); also by load test (`scripts/loadtest.mjs`) |
| 3 | Webhook ACK: WhatsApp `POST /webhooks/whatsapp/:key` | p95 < 1 s | Yes from the access log (`route=/webhooks/whatsapp/:key`); also by load test |
| 4 | AI turn latency (model + tools, from `ai_runs.latency_ms`) | p95 < 8 s (customer-visible reply also includes ~1.2 s debounce and WhatsApp send; track end to end separately) | Yes (query below) |
| 5 | Outbox lag: age of oldest `pending`/`processing` outbox row | < 60 s for 99% of minutes | Yes |
| 6 | Automation run success (not counting intended skips) | > 99% of runs end SUCCEEDED/SKIPPED, none stuck | Yes |
| 7 | Billing webhook health: failed/unprocessed `billing_events` | 0 older than 15 min | Yes |
| 8 | Server errors | 5xx < 0.5% of requests | Yes from the access log (`status >= 500`) once something aggregates the lines |

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

## Proposed alerts
| Alert | Condition | Severity | Who |
|---|---|---|---|
| API down | external probe of `/health/ready` fails 3 consecutive minutes | Sev 1 | On-call (page) |
| Worker not running | outbox lag > 120 s for 5 min, or no ECS worker task running | Sev 2 | On-call (page) |
| Outbox failures | `failed` outbox rows > 0 | Sev 3 | Engineering channel |
| Automation stuck | RUNNING > 15 min or QUEUED > 10 min | Sev 3 | Engineering channel |
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
- No request-duration or error-rate metrics: SLOs 2, 3, 8 cannot be measured in production until an access-log/metrics layer exists (OpenTelemetry/Prometheus or CloudWatch embedded metrics from ALB logs).
- No Sentry, no log aggregation, no alert routing. Logs are Nest console logs (plain text, not JSON); `x-request-id` is on every response and in error logs.
- `/health/ready` checks the database only in the code as audited by this document; confirm whether Redis was added before relying on it as a Redis check.
- Customer-visible AI latency (inbound webhook to outbound send) is not recorded as one number.
