# 09 — Performance & Scalability

**Separation of evidence:** *Measured* = recorded in `docs/performance.md` (2026-11-16, laptop, Postgres + Redis in Docker on the same machine, one tenant with 100k leads / 100k activities / 60k messages / 10k appointments). It predates campaigns, email tracking, Google Calendar and custom roles. *Architecture-based* = reasoning from code; no measurement exists. I did not run any load.

## 1. Measured (from `docs/performance.md`)

| Check | Result | Budget |
|---|---|---|
| Dashboard overview p50/p95 | 264 / 415 ms | 2000 ms |
| Lead list p95 | 88 ms | 800 ms |
| Lead search (trigram) p95 | 194–205 ms | 800 ms |
| Pipeline board p95 | 186 ms | 1500 ms |
| Concurrency (20 workers, 8 s) | dashboard 26 req/s p95 1068 ms; list 71 req/s p95 394 ms; search 44 req/s p95 567 ms; 0 errors | – |
| WhatsApp webhook ACK (40 sequential) | p50 27 ms, p95 91 ms | < 1 s |
| Rate limiter under load | engaged at 300 req/min/IP as designed | – |

Caveats stated in that document and repeated here: not production hardware, LLM latency unmeasured (mock), no soak, one large tenant, 1M+ leads untested, `messages` and `lead_activities` flagged as the tables to watch, serial per-tenant scanner needs sharding at thousands of tenants.

## 2. Architecture-based bottlenecks (ranked)

| # | Area | Evidence | Why it matters | Severity |
|---|---|---|---|---|
| P1 | **Campaign dispatch throughput** | `dispatchBatch`: sequential loop, per recipient one provider call + one 5-write transaction + 50 ms sleep; batch 50; next batch via a new job; one chain per campaign (`campaigns.service.ts:562-700`) | Per recipient ≈ provider latency (assume 150–400 ms) + ~50 ms sleep + DB tx. At ~0.3–0.5 s each, 100k recipients ≈ 8–14 h. Meta documents far higher Cloud API throughput (80 msg/s by default, per my recollection of Meta's docs; not verified here) and daily limits by messaging tier. Estimate, not a measurement | High (growth) |
| P2 | **Campaign launch memory/timeout** | `launch()` loads all matching leads and all consents (`IN (leadIds)`) into memory inside one transaction with the default 15 s timeout (`withTenant`) | Large segments (10⁴–10⁵) can exceed the timeout or the `IN` list size, leaving the campaign in DRAFT with an error | High |
| P3 | **Hot-row counters** | `broadcast_campaigns.sent_count` incremented per recipient in separate transactions | Row-lock contention only matters with parallel dispatch; will bite once P1 is fixed by adding parallelism | Medium |
| P4 | **Two transactions per request** | `TenantGuard` runs a membership+role+permissions transaction on every authenticated request, then the handler opens its own (`guards.ts`, `db.module.ts`) | ≥2 pool checkouts and round trips per call; no membership/permission cache (session validity *is* cached). With default `pg` pool (10) a few hundred rps will queue | Medium |
| P5 | **External I/O in DB transactions** | `syncAppointment(tx, …)` HTTP to Google inside the appointment transaction (`appointments.service.ts:282,303`) | Slow Google ⇒ connections held ⇒ pool starvation across tenants | Medium |
| P6 | **Bounded but in-memory bulk operations** | Lead import is capped at 5,000 rows (`lead-import.service.ts:15`); lead export is capped at 50,000 rows and builds the whole CSV in memory inside one transaction (`exportCsv`, `:179-193`, with an O(n·m) `users.find` inside the row map); workspace export is async (`DataExport`) | Caps make this safe now; a 50k-row export holds a connection and tens of MB per request, and tenants with more than 50k leads get a silently truncated export | Low–Medium |
| P7 | **Email event write amplification** | Every open/click performs `trackedEmail.update`, `emailEngagementEvent.create`, `leadActivity.create` in a tenant transaction on a public unthrottled route (`email-tracking.service.ts:317-370`); scanners and prefetchers multiply hits | Unbounded event table growth, row contention on `tracked_emails` | Medium |
| P8 | **SNS webhook lookup** | `findFirst OR [{sesMessageId},{smtpMessageId}]`; only `ses_message_id` is indexed, and not by tenant | Seq-scan risk on `smtp_message_id` as the table grows [validate with EXPLAIN] | Medium |
| P9 | **Single Redis** | BullMQ, throttler, session cache, locks, SSE pub/sub on one instance (`app.module.ts`, `jobs.service.ts`, `realtime.service.ts`) | Latency or outage degrades auth throttling, queues and realtime together | Medium |
| P10 | **Scanner fan-out** | `scanners.service.ts` iterates `list_active_tenant_ids()` serially each minute (also noted in `performance.md`) | At thousands of tenants a minute tick overruns; needs sharding/fan-out | Medium (later) |
| P11 | **Client-heavy frontend** | 50 of 51 pages are `'use client'`; page components of 500–800 lines; `@xyflow/react` for the automation builder | Larger JS payloads and no server-rendered data; bundle size was **not measured** (no `next build` output inspected) | Low–Medium |
| P12 | **Unbounded tables** | `messages`, `lead_activities`, `email_engagement_events`, `ai_runs`, `webhook_deliveries`: no partitioning (audit log is partitioned); retention exists for some (`lifecycle`, `automation-retention.test.ts`) | Index bloat and slow maintenance at 10⁸ rows | Medium (later) |
| P13 | **Dashboard query fan-out** | ~20 queries serialised in one transaction (`series()` in `analytics.module.ts:64`) — already improved per `performance.md` | Acceptable; watch with 1M leads | Low |

## 3. Horizontal scaling posture

| Layer | Can scale out? | Notes |
|---|---|---|
| API | Yes | Stateless; sessions in DB/Redis; throttler in Redis; SSE via Redis pub/sub with in-process fallback |
| Workers | Yes by tier (`all|outbox|ai`) | Outbox claim uses `SKIP LOCKED`; automation runs claim by CAS; maintenance singleton via lock; campaigns not safe to parallelise yet (S-02) |
| Postgres | Vertical + read replicas not used | All reads/writes go to one primary; no replica routing; connection pooling (pgbouncer) is anticipated by transaction-local settings but not configured in repo |
| Redis | Single instance | No Sentinel/Cluster guidance in code |
| Object storage | S3 | Fine |
| Web | Yes | Next.js server; CDN guidance only in `docs/deployment.md` |

## 4. Capacity guardrails missing
- No per-tenant fairness for queues (one tenant's campaign or import can monopolise `broadcast-campaigns` concurrency 3 and AI workers).
- No query timeouts / `statement_timeout` for the app role evident in code.
- No SLO dashboards deployed; `docs/slos-and-alerts.md` and alert rules exist in code only.
- No caching layer for read-heavy reference data (pipeline stages, plan entitlements, role permissions): each request re-reads.

## 5. Recommendations (ordered)
1. Rewrite the campaign sender as a leased, concurrent, rate-aware dispatcher; stream audience materialisation in chunks (`INSERT … SELECT`) instead of loading all leads; keep launch under the transaction timeout (≈ 5–8 days with S-02).
2. Cache membership + permission set per `(userId, tenantId)` in Redis (short TTL, invalidate on role/membership change): halves per-request DB work (≈ 2 days).
3. Move external I/O out of transactions: write an outbox event `appointment.calendar_sync` handled by the worker with retry (≈ 2 days).
4. Stream lead export instead of materialising 50k rows, and tell the user when the 50,000-row cap truncates; queue imports only if the 5,000-row cap is raised (≈ 3 days).
5. Add `statement_timeout`, explicit pool sizing, pgbouncer in the reference topology (≈ 2 days).
6. Re-run `scripts/loadtest.mjs` against a deployed staging, add campaign and webhook-burst scenarios, record results (≈ 3 days).
7. Partition `messages`/`lead_activities`/`email_engagement_events` by month before they exceed ~50M rows (≈ 5 days when needed).
