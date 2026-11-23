# System Architecture & Technical Topology: LeadPilot AI

## 1. Architectural Style & Core Patterns

**LeadPilot AI** is implemented as a **disciplined Modular Monolith** housed within a pnpm monorepo managed by Turborepo.

```
leadpilot-monorepo/
├── apps/
│   ├── api/        # NestJS 12 Modular HTTP Backend & REST Engine
│   ├── web/        # Next.js 16 (App Router) React 19 Frontend
│   └── worker/     # Thin Runner Process bootstrapping API modules for background jobs
├── packages/
│   ├── database/    # Prisma 7 schema, migrations, RLS extensions, seeders
│   ├── shared-types/# Universal DTOs, permission catalogues, OpenAPI schemas
│   ├── validation/  # Zod validation schemas shared across client and server
│   └── config/      # Shared tooling configurations (ESLint, TypeScript)
└── infrastructure/ # Docker Compose, ECS Fargate templates, CloudWatch alarms
```

### Key Architectural Patterns:
1. **Modular Monolith**: Modules within `apps/api/src/` represent bounded contexts (Identity, CRM, Communications, AI, Ops, SaaS). Direct cross-module database writes are forbidden; modules interact either via exported public service interfaces or asynchronously through domain events.
2. **Transactional Outbox Pattern**: State mutations that trigger external side effects (e.g., sending a WhatsApp message, triggering an AI run, dispatching a customer webhook) do not make external HTTP calls inside the transaction. Instead, they write an immutable `OutboxEvent` row into PostgreSQL within the same database transaction.
3. **Dedicated Background Worker**: `apps/worker` imports the exact same NestJS dependency-injection modules as `apps/api` but initializes without an HTTP listener. It runs the outbox relay, BullMQ job queues, and scheduled maintenance tasks, preventing background processing from degrading HTTP response latencies.
4. **Row-Level Security (RLS) Tenant Isolation**: PostgreSQL RLS is enabled on all 33+ tenant-scoped tables. Application queries execute through `withTenant()`, setting session variables (`app.tenant_id`) within interactive transactions.
5. **Contract-Driven API Generation**: The NestJS API automatically generates an OpenAPI 3.0 specification (`openapi.json`), which Orval compiles into type-safe React Query hooks and TypeScript clients in `apps/web`.

---

## 2. Existing Architecture Diagram

```mermaid
flowchart TD
    subgraph Clients["Client Layer"]
        Browser["Desktop & Mobile Web<br/>(Next.js 16 App Router)"]
        Widget["External Website Visitor<br/>(/widget.js Embed)"]
        Developer["Third-Party Developer / CRM<br/>(Public REST API /v1)"]
    end

    subgraph Entrypoints["Ingress & Edge Services"]
        ALB["Application Load Balancer<br/>(HTTPS, Security Headers, HSTS)"]
        Turnstile["Cloudflare Turnstile<br/>(Bot Protection Guard)"]
        Webhooks["External Webhook Ingress<br/>(Meta WhatsApp / Razorpay)"]
    end

    subgraph AppLayer["Application Layer (Modular Monolith)"]
        subgraph NestJS_API["apps/api (HTTP API Server)"]
            AuthGuard["AuthGuard & SessionCache"]
            TenantGuard["TenantGuard (Workspace Context)"]
            PermGuard["PermissionGuard & PlanGuard"]
            
            subgraph Modules["Domain Modules"]
                IdentityMod["Identity & RBAC"]
                CrmMod["CRM (Leads, Pipeline)"]
                CommsMod["Comms (WhatsApp, Inbox)"]
                AiMod["AI Assistant & RAG"]
                OpsMod["Ops (Appointments, Tasks)"]
                BillingMod["Billing & GST Invoices"]
            end
            
            OutboxWriter["Transactional Outbox Writer"]
        end

        subgraph NestJS_Worker["apps/worker (Background Process)"]
            OutboxRelay["Outbox Relay<br/>(FOR UPDATE SKIP LOCKED)"]
            BullWorker["BullMQ Worker<br/>(AI runs, WhatsApp sends)"]
            Scheduler["Minute Maintenance Scheduler<br/>(SLA, Reminders, Inactivity)"]
        end
    end

    subgraph DataLayer["Persistence & Infrastructure Layer"]
        Postgres[("PostgreSQL 17 + pgvector<br/>(Dual Roles: Owner vs App Role)<br/>Row-Level Security (RLS)")]
        Redis[("Redis 7<br/>- BullMQ Job Queues<br/>- Rate-Limit Counters<br/>- SSE Pub/Sub & Session Cache")]
        S3[("Object Storage (S3 / MinIO)<br/>Tenant-prefixed Buckets<br/>Documents & Lead Exports")]
        ClamAV["ClamAV Daemon<br/>(In-Memory Anti-Virus Scanning)"]
        KMS["AWS KMS / Local Envelope<br/>(Master Key Encryption)"]
    end

    subgraph ExternalProviders["External Third-Party Ecosystem"]
        Meta["Meta WhatsApp Cloud API"]
        OpenAI["OpenAI API (GPT-4o-mini & Embeddings)"]
        Razorpay["Razorpay Payments & Subscriptions"]
        SES["Amazon SES / SMTP Mail Server"]
    end

    %% Client flows
    Browser -->|Cookie Auth & HTTPS| ALB
    Widget -->|Visitor Token| ALB
    Developer -->|API Key (Bearer)| ALB
    Webhooks -->|Signed Payload| ALB

    ALB --> Turnstile
    Turnstile --> NestJS_API

    %% App pipeline
    NestJS_API --> AuthGuard
    AuthGuard --> TenantGuard
    TenantGuard --> PermGuard
    PermGuard --> Modules
    Modules --> OutboxWriter

    %% Database & Worker links
    OutboxWriter -->|Write Event in Transaction| Postgres
    Modules -->|withTenant Transaction with RLS| Postgres
    Modules -->|Cache & Rate Limits| Redis
    Modules -->|Scan Uploads| ClamAV
    Modules -->|Store Verified Files| S3
    Modules -->|Unwrap Secrets| KMS

    OutboxRelay -->|Claim Pending Events| Postgres
    OutboxRelay -->|Enqueue Jobs| Redis
    BullWorker -->|Consume Queue| Redis
    BullWorker -->|Execute Background Task| Modules
    Scheduler -->|Scan Breaches & Tick| Postgres

    %% Outbound Integrations
    BullWorker -.->|Send Templates / Messages| Meta
    BullWorker -.->|Chat Completions & Embeddings| OpenAI
    BullWorker -.->|Verify Webhook / Subscriptions| Razorpay
    BullWorker -.->|Dispatch Transactional Emails| SES
```

---

## 3. Component Interactions & Request Lifecycles

### A. End-to-End Inbound WhatsApp Lead Qualification Workflow

```
Customer Message (WhatsApp)
       │
       ▼
1. Meta Webhook Delivery ──▶ /webhooks/whatsapp
       │
       ▼
2. Signature & Auth ───────▶ Validate HMAC-SHA256 signature using Channel decrypted secret
       │
       ▼
3. Inbound Ingestion ──────▶ InboundService processes message:
                             - Finds/creates Lead record
                             - Creates Message entity (marked INBOUND)
                             - Writes `ai.turn.requested` event to `outbox_events` (Atomic DB Commit)
       │
       ▼
4. Outbox Relay ───────────▶ Worker picks up `ai.turn.requested` using `FOR UPDATE SKIP LOCKED`
                             and enqueues job into BullMQ `ai-orchestrator` queue.
       │
       ▼
5. AI Orchestrator ────────▶ BullMQ Worker runs orchestrator:
                             - Retrieves prompt context & last 10 messages
                             - Queries Knowledge Base using pgvector similarity search
                             - Calls LLM (OpenAI / Mock) with tool definitions
                             - If qualification criteria extracted: executes `qualify_lead` tool
                             - Formats grounded response
       │
       ▼
6. Outbound WhatsApp ──────▶ Writes `message.outbound` event to outbox.
                             Worker sends message to Meta Graph API.
       │
       ▼
7. Real-time Inbox ────────▶ Publishes event to Redis `lp:tenant:{id}:inbox`.
                             Agent browser UI updates live via Server-Sent Events (SSE).
```

### B. Human Takeover & Outbox Safety

When a sales representative opens a conversation in `/inbox` and types a reply:
1. The rep clicks **"Take Over"** or directly sends a message.
2. The controller verifies `conversation:reply` permissions.
3. The conversation mode transitions atomically from `BOT` to `HUMAN` via `ConversationsService.takeover()`.
4. Subsequent customer messages will no longer trigger AI worker turns, routing instead to the assigned agent's inbox queue and generating push/notification events.

---

## 4. Architectural Weaknesses & Structural Bottlenecks

### 1. Serial Tenant Maintenance Loop (Scalability Risk)
- **Location**: `apps/api/src/ops/scanners.service.ts`
- **Issue**: The once-a-minute scheduler runs a sequential loop over all active workspaces (`for (const tenant of activeTenants)`) to compute inactivity warnings, SLA breaches, and appointment reminder dispatches.
- **Impact**: While fast for 50 tenants (<200ms), at 2,000 tenants this serial scan will exceed the 60-second execution window, resulting in job overlaps and delayed reminders.

### 2. Contention on Outbox Relay (`FOR UPDATE SKIP LOCKED`)
- **Location**: `apps/api/src/ops/outbox-relay.ts`
- **Issue**: Outbox relay workers poll the single `outbox_events` table every 1000ms using row-level locking.
- **Impact**: Under high concurrency (e.g., bulk CSV import of 10,000 leads simultaneously firing welcome automations), lock contention on index scans of `outbox_events` will increase CPU load and Postgres connection wait times.

### 3. PostgreSQL RLS & Connection Pool Friction
- **Location**: `packages/database/src/index.ts` (`withTenant()`)
- **Issue**: RLS requires setting `app.tenant_id` via `set_config('app.tenant_id', ..., true)`.
- **Constraint**: This requires interactive database transactions. If PgBouncer or AWS RDS Proxy is placed in front of PostgreSQL, it **must run in Transaction Pooling Mode**, not Session Pooling Mode. Furthermore, queries within a single transaction cannot execute in parallel on one connection.

### 4. Memory Footprint in Document Processing
- **Location**: `apps/api/src/ai/knowledge/extract.ts`
- **Issue**: Ingesting large PDF brochures (>50 MB) loads raw binary buffers into Node.js memory.
- **Remediation Implemented**: PDF parsing was moved into an isolated worker process to prevent process-level memory leaks; however, streaming chunking should be adopted for multi-hundred-page documents.

### 5. Absence of Independent Worker Isolation
- **Location**: `apps/worker`
- **Issue**: `apps/worker` currently runs all background queues (outbox relay, minute scheduler, BullMQ worker, ClamAV document processor) inside a single Node.js runtime process.
- **Impact**: A memory-intensive document indexing job or heavy AI loop can starve the outbox relay of event-loop ticks, delaying outbound customer messages.
