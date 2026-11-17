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

**Billable series today: 23** (3 + 3 + 6 + 11). AWS gives the first 10 custom metrics free; at list price (about $0.30 per metric per month, **not verified for your region**) the rest are a few dollars a month. Total series written, billable or not, is roughly 45-60. Turn everything off with `METRICS_EMF=false`.

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

