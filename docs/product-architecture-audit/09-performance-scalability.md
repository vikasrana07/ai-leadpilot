# Performance & Scalability Assessment: LeadPilot AI

## 1. Measured Performance Baseline (Local Benchmark)

Performance benchmarks were executed using `scripts/loadtest.mjs` against a production build of `apps/api` running on local hardware (Apple Silicon) backed by PostgreSQL 17 and Redis 7 in Docker.

The test dataset simulated a high-volume tenant workspace containing:
- **100,000 Leads**
- **100,000 Activities**
- **10,000 Conversations & 60,000 Messages**
- **10,000 Appointments**

### Sequential Request Benchmarks (20 requests per endpoint, post warm-up)
| Operation / Endpoint | Budget (SLA) | Measured p50 | Measured p95 | Status |
|---|:---:|:---:|:---:|:---:|
| **Dashboard Overview (30 Days)** | < 2,000 ms | 264 ms | 415 ms | **PASSED** (79% margin) |
| **Dashboard Overview (Current Month)**| < 2,000 ms | 264 ms | 334 ms | **PASSED** (83% margin) |
| **Lead List (Page 1 Default Sort)** | < 800 ms | 82 ms | 88 ms | **PASSED** (89% margin) |
| **Lead List Sorted by Score** | < 800 ms | 80 ms | 90 ms | **PASSED** (89% margin) |
| **Lead Trigram Search (Name)** | < 800 ms | 158 ms | 194 ms | **PASSED** (76% margin) |
| **Lead Trigram Search (Phone)** | < 800 ms | 171 ms | 205 ms | **PASSED** (74% margin) |
| **Filtered Query (Hot + Unassigned)** | < 800 ms | 47 ms | 64 ms | **PASSED** (92% margin) |
| **Pipeline Kanban Board View** | < 1,500 ms | 142 ms | 186 ms | **PASSED** (88% margin) |
| **Conversation List (Inbox)** | < 800 ms | 12 ms | 22 ms | **PASSED** (97% margin) |
| **Appointments Month Grid** | < 1,000 ms | 9 ms | 11 ms | **PASSED** (99% margin) |
| **WhatsApp Webhook Ingress (ACK)** | < 1,000 ms | 27 ms | 91 ms | **PASSED** (91% margin) |

### Concurrent Load Profile (20 concurrent workers over 8 seconds)
- **Dashboard Throughput**: 26 req/sec | p95 = 1,068 ms | 0 errors.
- **Lead List Throughput**: 71 req/sec | p95 = 394 ms | 0 errors.
- **Lead Search Throughput**: 44 req/sec | p95 = 567 ms | 0 errors.
- **Webhook Processing**: Sub-100ms ACK times ensure zero Meta webhook timeouts.

---

## 2. Front-End Bundle & Client-Side Rendering Performance

### Next.js 16 App Router Evaluation
- **Bundle Strategy**: Web application uses Turbopack/Next.js code splitting. Heavy components (such as the `@xyflow/react` visual DAG canvas, `recharts` analytics graphs, and PDF document previewers) are dynamically imported using `next/dynamic` with `ssr: false`, preventing excessive initial bundle payloads.
- **Rendering Model**:
  - The application shell and skeleton layouts render via Server Components (RSC).
  - Data grids (`/leads`), Kanban boards (`/pipeline`), and chat interfaces (`/inbox`) utilize TanStack React Query on the client to facilitate optimistic UI updates and live Server-Sent Events (SSE) patching.
- **Font Optimization**: Uses `geist/font` with native zero-layout-shift font optimization and local fallback metrics.

---

## 3. Database Query Efficiency & Optimization Patterns

### Elimination of Interactive Transaction Queue Bottlenecks
During Phase 7 optimization, a significant query latency spike (up to 1.8 seconds) was diagnosed on `/dashboard`.
- **Root Cause**: The dashboard executed 20 parallel queries inside a single interactive transaction via `Promise.all()`. Because an interactive transaction binds to a single physical PostgreSQL connection, the queries queued serially behind each other, triggering `pg` client driver deprecation warnings.
- **Architectural Fix**: Introduced the typed sequential runner `series()` (`apps/api/src/common/series.ts`). All transaction-bound multi-query aggregations now execute sequentially, reducing dashboard p95 latency from 1,800ms down to 415ms.

### Indexing Efficiency (Trigram Search on 100k Rows)
```sql
CREATE INDEX idx_leads_search_name ON leads USING gin (name gin_trgm_ops);
CREATE INDEX idx_leads_search_phone ON leads USING gin (phone gin_trgm_ops);
```
EXPLAIN ANALYZE on a 100,000-lead database demonstrates that trigram searches execute via Bitmap Index Scans in under 12ms, well within interactive UI budgets.

---

## 4. Scalability Limits & Bottlenecks (10x Growth Projections)

Evaluating the architecture against a **10x growth trajectory** (1,000 active tenants, 1,000,000 leads, 10,000,000 messages):

```
┌────────────────────────────────────────────────────────────────────────┐
│                   10x SCALABILITY BOTTLENECK ANALYSIS                  │
├──────────────────────────────┬──────────────────┬──────────────────────┤
│ Component                    │ Current Capacity │ 10x Projected Limit  │
├──────────────────────────────┼──────────────────┼──────────────────────┤
│ 1. Serial Minute Scheduler   │ ~150 tenants     │ FAILS at >500 tenants│
│ 2. Outbox Relay Polling      │ ~250 events/sec  │ CONFLICTS on locks   │
│ 3. Unpartitioned Messages    │ ~100k rows       │ SLOWS at >5M rows    │
│ 4. Vector Similarity Search  │ ~50k chunks      │ DEGRADES at >500k    │
│ 5. Redis SSE Single Instance │ ~5,000 concurrent│ SATURATES at >20k    │
└──────────────────────────────┴──────────────────┴──────────────────────┘
```

### Bottleneck 1: Serial Minute Maintenance Scanner
- **Location**: `apps/api/src/ops/scanners.service.ts`
- **Issue**: The maintenance job iterates sequentially through every active tenant in the database to detect SLA breaches and check inactive conversations.
- **10x Impact**: At 1,000 tenants, iterating sequentially will consume 120-180 seconds, breaking the 60-second execution cadence.
- **Remediation**: Shard the tenant list across multiple worker queues using a modulo partition hash (`tenant_id % N_WORKERS`), enabling concurrent multi-worker scanning.

### Bottleneck 2: Outbox Table Contention (`FOR UPDATE SKIP LOCKED`)
- **Location**: `apps/api/src/ops/outbox-relay.ts`
- **Issue**: Polling `outbox_events` every 1,000ms using row locks creates hot index pages when multiple worker replicas compete for jobs.
- **10x Impact**: Under bulk message bursts, database CPU spikes due to lock acquisition.
- **Remediation**: Partition `outbox_events` by date/status, or migrate high-throughput asynchronous job dispatching directly to Redis/BullMQ streams, reserving PostgreSQL outbox only for transactional guarantees.

### Bottleneck 3: Message Table Growth
- **Location**: `packages/database/prisma/schema.prisma` (`Message`)
- **Issue**: `messages` is an unpartitioned table storing both inbound customer chats and automated bot logs.
- **10x Impact**: At 10M messages, index tree depth increases query times for historic conversation views.
- **Remediation**: Partition `messages` by month or quarter based on `created_at`.

### Bottleneck 4: PostgreSQL `pgvector` Index Scaling
- **Location**: `apps/api/src/ai/knowledge/storage.ts`
- **Issue**: Uses standard vector distance operators (`<=>`) over `vector(1536)`.
- **10x Impact**: Without an HNSW (Hierarchical Navigable Small World) index, vector cosine searches perform sequential table scans over document chunks.
- **Remediation**: Ensure an explicit HNSW index is generated:
  ```sql
  CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  ```
