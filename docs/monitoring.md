# Monitoring and logging

**Status:** milestones 1 and 2 of the monitoring plan are built (structured logs, redaction, request context, crash handlers, friendly error pages; metrics, CloudWatch-format output, the database health snapshot and the worker heartbeat). Alert rules, alert emails and the Ops Status page are milestone 3 and are **not built yet**. Nothing here has run on AWS or against a real log collector. No new dependencies, no paid vendor.

## What exists today
| Piece | Where | Notes |
|---|---|---|
| Structured application log | `apps/api/src/observability/logger.ts` | One JSON object per line in production; readable lines in development. Used by the API and the worker for every `new Logger('X')` in the code base. |
| Access log | `apps/api/src/common/middleware.ts` | One JSON line per request (`ACCESS_LOG`), route pattern only, with `requestId`, `tenantId`, `userId`. Health probes skipped. |
| Request context | `observability/request-context.ts` | `AsyncLocalStorage`: every log line written while handling a request carries its `requestId`, and `tenantId` / `userId` once the guards have resolved them. Worker jobs carry `jobId` and `tenantId`. |
| Redaction | `observability/redact.ts` | Applied to every message and every string field before it is written. |
| Crash handlers | `observability/process-handlers.ts` | `uncaughtException` and `unhandledRejection` log a fatal line (redacted, fingerprinted), flush stdout, exit 1 so ECS starts a new task. |
| 500 logging | `common/http-exception.filter.ts` | Unexpected errors only (4xx are in the access log): route, ids, stable fingerprint, redacted stack. The client still gets only `Something went wrong` + `requestId`. |
| Health | `GET /health`, `GET /health/ready` | Unchanged. |
| Web error pages | `apps/web/app/error.tsx`, `global-error.tsx`, `not-found.tsx` | Friendly copy, a retry button, a way home, and a reference (the API request id, else Next's digest) for support. |

## Log line format (production)
```json
{"ts":"2026-11-17T13:01:19.656Z","level":"info","msg":"request","requestId":"req-m1-leads-0001","method":"GET","route":"/leads","status":200,"durationMs":18.3,"tenantId":"...","userId":"..."}
{"ts":"...","level":"error","context":"HttpError","msg":"Unhandled exception: Error: db exploded for [email] phone [phone] token=[redacted]","requestId":"...","userId":"...","route":"GET /auth/me","fingerprint":"3fa9c1d20b7e","stack":"..."}
```
Fields: `ts` (ISO UTC), `level` (`verbose|debug|info|warn|error|fatal`), `context` (the Nest logger name), `msg`, then `requestId`, `tenantId`, `userId`, `jobId` when known, plus structured fields such as `route` and `fingerprint`. Ids only; never names, emails, phone numbers, message text or tokens.

**Fingerprint** = hash of the error name and its top three stack frames with line numbers and install paths removed. The same bug from different requests (or after an unrelated edit) has the same fingerprint, so you can count and group occurrences with a log query.

Nest's startup chatter (one line per mapped route) is written only at `debug` level or below.

## Redaction rules (`redact()`)
Replaced with a marker: JWTs, `Bearer`/`Basic` credentials, API keys (`lp_`, `sk-`, `rzp_`, `whsec_`, `AKIA`, Slack), `password|secret|token|api_key|authorization|cookie|signature` values, email addresses, PAN, Aadhaar-style `1234 5678 9012`, phone numbers (`+` numbers, Indian `98765 43210`), any run of 10 or more digits (this also hides epoch milliseconds: intended, it prefers hiding a harmless number to leaking a phone number), 32+ hex characters, and long mixed-case tokens. Left readable: UUIDs, request ids (`req-123.abc`), ISO dates, route patterns, HTTP statuses, error codes. This is a safety net, not a licence to log personal data: do not put message text, names or contact details into a log call in the first place.

## Configuration
| Variable | Default | Meaning |
|---|---|---|
| `LOG_FORMAT` | `json` in production, `pretty` elsewhere | Output format. |
| `LOG_LEVEL` | `log` | Minimum level: `verbose < debug < log < warn < error`. |
| `ACCESS_LOG` | on in production | The per-request JSON line. |
| `METRICS_EMF` | on in production, off elsewhere | Write the metrics as CloudWatch EMF lines (the in-process registry always records; only the output is gated). |
| `METRICS_INTERVAL_SECONDS` | `60` | How often the EMF lines are written (5-3600). |
| `ALERTS_ENABLED`, `ALERT_EMAIL_TO`, `ALERT_REPEAT_HOURS` | off / empty / 6 | Reserved for milestone 3 (read and validated now, not used yet). |

## Try it locally
1. Start the API with `LOG_FORMAT=json ACCESS_LOG=true` (for example `LOG_FORMAT=json ACCESS_LOG=true node --env-file=../../.env dist/main.js` from `apps/api`) and use the app. Every line is JSON; personal data shows as `[email]`, `[phone]`, `[redacted]`.
2. Pipe through `jq` to filter: `... | jq -c 'select(.level=="error")'`, or by one request: `select(.requestId=="req-...")`.
3. The error screen: run the web app in development and open `/dev-error` (a deliberate render error with a demo reference). In a production build that route is a normal 404.
4. A startup crash (for example production mode with mock providers) shows the fatal JSON line and a non-zero exit.
5. Automated: `apps/api/test/observability.test.ts` (redaction, logger, context, fingerprint, crash handlers, the 500 path), `apps/web/components/error-view.test.tsx`, `e2e/tests/16-error-pages.spec.ts`.

## Limits and not done yet
- No log shipping, retention or search exists locally; on AWS the container's stdout goes to CloudWatch Logs (not configured in this repo yet).
- The request id is not yet carried from an API request into the background jobs it creates; jobs log their own `jobId`.
- A browser-side error beacon is not built: a client error is shown to the user with a reference but is not reported to the server.
- The redaction patterns are heuristic; unusual identifiers can pass through.
- The error boundary (`error.tsx`) is covered by a render test, not by an end-to-end test, because it cannot be triggered in a production build without a broken page.

## Metrics (milestone 2)
**What it is.** A tiny in-process registry (`apps/api/src/observability/metrics.ts`, no dependency) records request, job and AI outcomes. Every `METRICS_INTERVAL_SECONDS` the API and the worker write them to stdout as **CloudWatch Embedded Metric Format (EMF)** JSON lines (`observability/emf.ts`, namespace `LeadPilot`, dimension `Service=api|worker`). On AWS, CloudWatch Logs turns the declared metrics into custom metrics automatically; you do not need CloudWatch to read the lines (see "Try it locally").

**Counters and histograms are deltas** for the interval (activity only: a series with no events is not written; for alarms treat missing data as "not breaching"). **Gauges** are the last value. Histograms are written as `<Name>Count`, `<Name>Sum<Unit>` and `<Name>Max<Unit>` fields, plus an estimated p95 (`<Name>P95<Unit>`) estimated from fixed buckets (per instance; CloudWatch cannot merge percentiles across instances, so alarm on the worst instance or the average of the p95s).

**Cost control.** Only metrics flagged *billable* are declared to CloudWatch (and so become custom metrics). Everything else is written as a plain field on the same line, free to search with Logs Insights. Labels are fixed lists (`StatusClass`, `RouteGroup`, `Job`, `Outcome`); an unknown value becomes `other`, an undeclared label is dropped, and each metric has a series cap. No tenant id, user id, path or id ever becomes a label.

| Metric | Kind | Dimensions | Billable | Notes |
|---|---|---|---|---|
| `RequestCount` | counter | `StatusClass` 2xx/4xx/5xx | yes (3) | Health probes skipped. Independent of `ACCESS_LOG`. |
| `RequestDuration` (`...P95Ms` billable; Count/Sum/Max fields) | histogram | `RouteGroup` analytics/webhook/other | p95 only (3) | SLOs 2 and 3. |
| `JobFailures` | counter | `Job` automation/outbox/webhook/scanner/billing/ai | yes (6) | Alarm on any increase. |
| `JobOutcome` | counter | `Job` x `Outcome` ok/failed/skipped | no | Log field only. Webhook `skipped` = a failed attempt that will be retried. |
| `ScannerTick`, `AiRunLatency` | histogram | none | no | Count/Sum/Max fields. |
| 22 snapshot gauges (below) | gauge | none | 11 billable | Published by the once-a-minute tick. |
| 4 alert gauges (`AlertsFiring`, `AlertsFiringSev1/2/3`) | gauge | none | 1 billable (`AlertsFiring`) | Number of firing alerts (milestone 3). |

**Billable series today: 24** (3 + 3 + 6 + 11 + 1 for `AlertsFiring`). AWS gives the first 10 custom metrics free; at list price (about $0.30 per metric per month, **not verified for your region**) the rest are a few dollars a month. Total series written, billable or not, is roughly 45-60. Turn everything off with `METRICS_EMF=false`.

**Gauges** (from `ops_health_snapshot()` once a minute, plus queue depth and heartbeats): `OutboxPending`, `OutboxOldestPendingSeconds`\*, `OutboxFailed`\*, `RunsStuckRunning`\*, `RunsQueuedOld`\*, `RunsWaitingOverdue`\*, `RunsFailedLastHour`, `BillingEventsNeedingAttention`\*, `WebhookEventsUnprocessed`\*, `OutboundMessagesFailedLastHour`, `WebhookDeliveriesOverdue`, `WebhookDeliveriesFailedLastHour`, `WebhookEndpointsDisabled`, `AiRunsLast15Min`, `AiFailedLast15Min`\*, `AiLatencyP95Ms24h`\*, `QueueRunsWaiting`, `QueueRunsActive`, `QueueRunsDelayed`, `QueueRunsFailed`\*, `WorkersAlive`\*, `WorkerHeartbeatAgeSeconds` (\* = billable).

### The database snapshot
`ops_health_snapshot()` (migration `20261117120000_ops_health_snapshot`) is a `SECURITY DEFINER` function returning **counts and ages only** across all workspaces: no tenant id, user id or content (a test checks the output contains none). Its thresholds are the queries from `docs/slos-and-alerts.md` (stuck RUNNING over 15 min, QUEUED over 10 min, WAITING overdue over 15 min, billing events needing attention over 15 min, unprocessed WhatsApp deliveries over 5 min, and so on). Only the app role can execute it.

`HealthSnapshotService.tick()` runs inside the single once-a-minute maintenance job (one run per minute however many workers exist). It calls the function, reads BullMQ queue depth and the worker heartbeats, publishes the gauges, keeps the latest copy in memory and in Redis under `<QUEUE_PREFIX>:ops:snapshot` (5 minute lifetime) for the Ops page and alert rules (milestone 3).

### Worker heartbeat
Each background process (the worker, or the API with `WORKERS_ENABLED=true`) writes `<QUEUE_PREFIX>:worker:heartbeat:<instanceId>` to Redis every 30 s with a 90 s lifetime (`{instanceId, startedAt, lastBeat, version}`). `WorkersAlive` is the number of live keys; if every key has expired, no worker is running (or Redis is down). If Redis is unreachable the heartbeat logs one warning and carries on.

## Try it locally
1. Start the API with `METRICS_EMF=true METRICS_INTERVAL_SECONDS=10 WORKERS_ENABLED=true` (use your own `QUEUE_PREFIX` to keep the queues separate), make a few requests, and read the terminal: lines with `"msg":"metrics"` appear every 10 seconds. Billable ones contain an `_aws` object; the rest are plain fields. Filter with `jq -c 'select(.msg=="metrics")'`.
2. See the latest snapshot: `redis-cli -p 6380 GET <QUEUE_PREFIX>:ops:snapshot | jq`. Create a stuck run (set a `RUNNING` run's `started_at` 20 minutes back) and watch `automation_runs.stuck_running` rise within a minute.
3. See the heartbeat: `redis-cli -p 6380 --scan --pattern '<QUEUE_PREFIX>:worker:heartbeat:*'`; stop the worker and the key disappears within 90 seconds.
4. Automated: `apps/api/test/metrics.test.ts` (registry, histograms, EMF shape, cardinality, emitter with a fake clock) and `apps/api/test/ops-health.test.ts` (snapshot counts across workspaces, no tenant data, privileges, tick, heartbeat, Redis down).

## Limits (milestone 2)
- Nothing here has been read by real CloudWatch. The EMF lines follow the published specification and are unit-tested against it.
- In-process metrics are per instance; aggregation and percentiles across instances happen in CloudWatch (p95 is an estimate from fixed buckets).
- Webhook "skipped" outcome means a failed attempt that will be retried; the delivery table has the final result.
- The snapshot counts stay global: there is no per-workspace breakdown by design.

## Alerts and the Ops Status page (milestone 3)

**What it does.** Once a minute the alert rules (`apps/api/src/ops/alert-rules.ts`) are evaluated against the latest health snapshot and the live worker heartbeats. A rule that is breached for its number of minutes in a row **fires**; a firing rule that is fine for 2 evaluations in a row **resolves**. State changes and repeats send a plain-text email (`MailService.sendAlert`) and write a structured log line (`alert firing ...` at ERROR level, `alert resolved ...` at INFO, so a CloudWatch log filter can catch them). State lives in the platform-only table `ops_alerts` (RLS: invisible inside any tenant context; the app role cannot delete rows). Nothing evaluates or emails unless `ALERTS_ENABLED=true`; the Ops page still shows live rule state without it.

**Who evaluates.** The worker's maintenance job (right after the snapshot is published) **and** every API process on its own timer, guarded by a Redis lock (`<QUEUE_PREFIX>:ops:alerts:lock`, 50 s) so it runs about once a minute overall. The API timer matters: if the worker is dead nobody else would notice. Every state change is a compare-and-set in the database, so a failed lock (Redis down) or two racing evaluators still send each email once. If the snapshot is older than 3 minutes the database rules are "unknown" (their state is left alone) and the `snapshot_stale` rule fires instead.

**Recipients.** `ALERT_EMAIL_TO` (comma separated) if set, otherwise every ACTIVE platform admin. If there is nobody to tell, one warning is logged and nothing is claimed, so the email goes out as soon as a recipient exists. Mail failures are logged and never break evaluation. Email text holds the rule title, severity, start time, numbers, the runbook path and the Ops page link: no workspace names, emails or message content.

**Damping.** At least 15 minutes between two emails about the same alert (`EMAIL_DAMPING_MINUTES`). A firing email held back by the window is sent on a later evaluation if the alert is still firing; a "resolved" email is held until the window has passed (so an alert that fires and clears within 15 minutes sends the firing email now and the resolved email at the 15-minute mark). Sev 1-2 alerts that stay firing repeat every `ALERT_REPEAT_HOURS` (default 6); Sev 3 never repeats.

| Rule key | Sev | Fires when | For | Runbook |
|---|---|---|---|---|
| `snapshot_stale` | 2 | no snapshot, or older than 180 s (the maintenance job is not running) | 2 min | worker-and-queues |
| `worker_not_running` | 2 | no live worker heartbeat in Redis | 3 min | worker-and-queues |
| `outbox_lag` | 2 | oldest pending outbox event older than 120 s | 5 min | worker-and-queues |
| `outbox_failed` | 3 | any failed outbox row | 1 min | worker-and-queues |
| `automation_runs_stuck` | 3 | RUNNING over 15 min or QUEUED over 10 min | 1 min | worker-and-queues |
| `automation_waits_overdue` | 2 | a WAITING run more than 15 min past its resume time | 1 min | worker-and-queues |
| `billing_events_attention` | 2 | a billing event failed or unprocessed over 15 min | 1 min | billing-incident |
| `whatsapp_unprocessed` | 2 | WhatsApp webhook events unprocessed over 5 min | 1 min | webhooks |
| `ai_failure_rate` | 2 | at least 10 AI runs in 15 min and over 20% failed | 1 min | ai-incident |
| `outbound_messages_failing` | 3 | 10 or more outbound messages failed in the last hour | 1 min | webhooks |
| `webhook_deliveries_failing` | 3 | customer webhook deliveries overdue, 20+ failed in the last hour, or an endpoint auto-disabled | 1 min | webhooks |

All thresholds are in one constant table (`THRESHOLDS`). **Not measured by the app** (they need something outside it): API availability (an external probe of `/health/ready`), RDS and Redis resource alarms, backups, AI cost spikes, login-abuse spikes. See `infrastructure/monitoring/` (milestone 4) and `docs/slos-and-alerts.md`.

**An app that is down cannot email.** If every API and worker process is dead, no alert is sent. Run an external probe of `/health/ready` (a free uptime monitor, or a CloudWatch alarm on the load balancer's healthy-host count) and send it to a different channel than this email.

**Ops Status page.** Platform console, **Ops status** (`GET /platform/ops`, platform session only, read-only): firing alerts with hint and runbook, all rules with their live state, the health numbers, queue depth, worker heartbeats, the SLO table (4-7 show current values; 1-3 and 8 say where they are measured), and "Recently resolved". It refreshes every 30 seconds and warns when the snapshot is stale.

### Try it locally
1. Start the API with `ALERTS_ENABLED=true ALERT_EMAIL_TO=you@example.test WORKERS_ENABLED=true` (your own `QUEUE_PREFIX` keeps the queues separate). Mailpit's web UI is at http://localhost:8026 in this repository's compose file.
2. Make a real condition. Fastest: insert a failed outbox row (`status='failed'`, `attempts=10`), which fires `outbox_failed` after one evaluation (about 1-2 minutes). Or stop the worker (and use a separate API with workers off) to see `worker_not_running` after 3 minutes.
3. Watch the firing email arrive, open **Platform console > Ops status**, then fix the condition. After 2 fine evaluations the alert resolves; the resolved email follows once the 15-minute damping window has passed (to see it sooner, set `last_notified_at` back by 20 minutes in `ops_alerts`).
4. Automated: `apps/api/test/alert-rules.test.ts` (every threshold edge, recipients, email text) and `apps/api/test/alerts.test.ts` (state machine with a fake clock, hysteresis, damping, repeat, two racing evaluators, disabled gate, mail failure, RLS, `/platform/ops` access), and `e2e/tests/17-ops-status.spec.ts` (page, axe in both themes, 375 px).

### Limits (milestone 3)
- Real inbox delivery and real CloudWatch log filters are not verified; the local test used Mailpit.
- Two evaluators racing each count as a fine or failing minute, so a rule can fire or resolve one minute early; the Redis lock makes this rare and the database prevents duplicate emails either way.
- Alerts are per platform, not per workspace; there is no acknowledge, mute or on-call routing (the email list is the routing).

