# Performance: load test against the budgets (2026-11-16)

Budgets (MASTER_PROMPT B4): dashboard < 2 s at 100k leads per tenant; webhook ACK < 1 s; AI reply p95 < 8 s.

## Method
`scripts/loadtest.mjs` (no dependencies) against the production build of the API on a laptop (Apple silicon, Postgres 17 + Redis in Docker on the same machine, so network latency is ~0 and the database shares CPU with the test client).
Data: one tenant with **100,000 leads**, 100,000 activities, 10,000 conversations / 60,000 messages, 10,000 appointments (plus ~13 small tenants sharing the database). Rate limiting was raised for the concurrent phase only.
Seed SQL is in this document's history (generate_series inserts as the owner role); the tenant is local test data.

## Results (sequential, 20 requests each, after warm-up)
| Endpoint | p50 | p95 | Budget |
|---|---|---|---|
| Dashboard overview, 30 days | 264 ms | 415 ms | 2000 ms |
| Dashboard overview, this month | 264 ms | 334 ms | 2000 ms |
| Lead list (page 1) | 82 ms | 88 ms | 800 ms |
| Lead list sorted by score | 80 ms | 90 ms | 800 ms |
| Lead search by name (trigram) | 158 ms | 194 ms | 800 ms |
| Lead search by phone (trigram) | 171 ms | 205 ms | 800 ms |
| Filter hot + unassigned | 47 ms | 64 ms | 800 ms |
| Pipeline board | 142 ms | 186 ms | 1500 ms |
| Conversation list | 12 ms | 22 ms | 800 ms |
| Appointments (month) | 9 ms | 11 ms | 1000 ms |
| Usage | 56 ms | 74 ms | 1000 ms |
| Team workload | 33 ms | 37 ms | 1000 ms |

Concurrent (20 workers, 8 s each): dashboard 26 req/s, p95 1068 ms; lead list 71 req/s, p95 394 ms; lead search 44 req/s, p95 567 ms; **0 errors**. WhatsApp webhook ACK (40 sequential signed inbound messages): **p50 27 ms, p95 91 ms, max 171 ms** against the 1000 ms budget.

## Findings
- An early run showed a one-off 1.8 s dashboard request. Cause: the dashboard ran ~20 queries with `Promise.all` inside one interactive transaction (one connection, so they queue, and `pg` warns that concurrent queries on a client are deprecated and removed in pg 9). All such transaction-bound calls (14 sites) now run through `series()` (sequential, typed); the dashboard is steadier (p95 415 ms) and the deprecated pattern is gone.
- Rate limiting works under load: the first concurrent run hit the 300 requests/minute/IP limit (HTTP 429), as designed.
- No missing index was found at this size; EXPLAIN on the stage-transition join used by the conversion KPI is sub-millisecond.

## Not measured / caveats
- **Not production hardware or network**: expect different absolute numbers on RDS + Fargate; re-run `scripts/loadtest.mjs` against staging.
- **AI reply p95 < 8 s is unmeasured**: no real LLM has been connected (mock only).
- Inbox and lead list virtualisation, and browser rendering time of the dashboard, were not measured (API only).
- Only one large tenant; no soak test; no test of many tenants' background scanners at once (the minute scanner visits every active tenant serially: at thousands of tenants it needs sharding).
- Larger working sets (1M+ leads, 10M messages) are untested; `messages` and `lead_activities` are the tables to watch (partitioning is not implemented).
