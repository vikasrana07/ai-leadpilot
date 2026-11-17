# Monitoring and logging

**Status:** milestone 1 of the monitoring plan is built (structured logs, redaction, request context, crash handlers, friendly error pages). Metrics, alert rules, alert emails and the Ops Status page are milestones 2 and 3 and are **not built yet**. Nothing here has run on AWS or against a real log collector. No new dependencies, no paid vendor.

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
| `METRICS_EMF`, `ALERTS_ENABLED`, `ALERT_EMAIL_TO`, `ALERT_REPEAT_HOURS` | off / off / empty / 6 | Reserved for milestones 2 and 3 (read and validated now, not used yet). |

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
