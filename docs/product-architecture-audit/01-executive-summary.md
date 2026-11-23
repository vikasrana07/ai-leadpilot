# Executive Summary: LeadPilot AI Platform Architecture & Product Audit

## 1. Product Overview

**LeadPilot AI** is a multi-tenant, AI-powered conversational lead management, qualification, and sales automation B2B SaaS platform. Its core value proposition is captured by its mission statement: *"Never lose a potential customer because of a missed enquiry, delayed response, or forgotten follow-up."*

Initially tailored for high-ticket, high-touch transaction environments—specifically **Indian Real Estate Agencies**, with extension packs for **Coaching Institutes, Healthcare/Clinics, and Home Services**—LeadPilot replaces fragmented sales toolchains (spreadsheets, personal WhatsApp web sessions, basic web forms, and generic CRMs) with a unified, automated operational engine.

### Key Capabilities Identified in Codebase:
1. **Multi-Channel Lead Ingestion**: Captures leads via WhatsApp inbound messages, customizable embeddable website widgets (`/widget.js`), authenticated REST API keys (`/v1/leads`), and CSV imports (with native parsing for Indian currency notations like `Lakh` and `Crore`).
2. **AI Sales Orchestrator & Knowledge Retrieval**: Utilizes an automated AI sales assistant (with LLM and deterministic rule fallbacks) connected to a vector-indexed knowledge repository (PostgreSQL `pgvector`, ClamAV scanned, S3/MinIO stored) to autonomously answer customer queries, extract buyer criteria (budget, location, timeline, unit preference), and score lead temperature (`HOT`, `WARM`, `COLD`).
3. **Omnichannel Unified Team Inbox**: Three-pane real-time messaging console supporting agent takeover, internal private notes, automated 24-hour WhatsApp messaging window enforcement, customer opt-out processing, canned templates, and Server-Sent Events (SSE) live updates.
4. **Visual Automation Engine & DAG Scheduler**: A dual-interface automation system featuring 8 pre-built operational templates as well as a custom graph/DAG visual builder (powered by `@xyflow/react` and an outline tree editor), executing multi-step conditional workflows, delays, and outbox actions.
5. **Appointment Scheduling Engine**: Double-booking-proof booking calendar with tenant-defined working hours, buffer times, service types, and automated appointment reminders.
6. **Multi-Tenant SaaS Foundation & Commercialization**: Full organization hierarchy, Row-Level Security (RLS) data isolation, role-based access control (RBAC with 32 granular permissions), TOTP-based Multi-Factor Authentication (MFA), Indian GST-compliant invoice generation, and Razorpay subscription lifecycle management.
7. **Platform Administration & Observability**: Super-admin console (`/platform`) providing workspace tenant lifecycle management, feature gating, emergency support impersonation sessions, CloudWatch Embedded Metric Format (EMF) instrumentation, and real-time operational alerts.

---

## 2. Architecture Maturity Assessment

The LeadPilot codebase exhibits an unusually high level of architectural discipline for an early-stage SaaS platform, implemented as a **disciplined Modular Monolith** rather than an undisciplined distributed microservices mesh or an unorganized monolith.

| Dimension | Rating | Description & Evidence |
|---|:---:|---|
| **Architectural Style** | **8.5 / 10** | Well-bounded modular monolith in NestJS (`apps/api`) with a shared background worker entrypoint (`apps/worker`), transactional outbox pattern, BullMQ queues over Redis, and clean module contracts. |
| **Data Architecture & Isolation** | **9.0 / 10** | PostgreSQL with dual connection roles (`owner` vs `app`). Strict Row-Level Security (RLS) enforced across 33+ tenant tables via `withTenant()` transaction scopes and `current_setting('app.tenant_id')`. Audit logging partitioned by month. |
| **Security Architecture** | **8.5 / 10** | Envelope encryption (AWS KMS / local AES-256-GCM) for sensitive credentials, TOTP MFA with recovery codes, SSRF-safe outbound HTTP client, Cloudflare Turnstile bot verification, strict CORS, and security headers. |
| **API & Contract Design** | **8.0 / 10** | 265 REST endpoints generated via NestJS Swagger into a centralized OpenAPI spec, driving typed Orval React Query hooks in the frontend. Public `/v1` API with scoped API keys and idempotency keys. |
| **Frontend Architecture** | **7.5 / 10** | Next.js 16 (App Router) + React 19 + Tailwind CSS v4 + Radix UI + Zustand + TanStack Query. High keyboard accessibility and responsive design, though client-heavy rendering patterns exist. |
| **Reliability & Background Jobs** | **8.0 / 10** | Transactional outbox relay with `FOR UPDATE SKIP LOCKED`, BullMQ distributed queue, automated dead-letter queues, orphan sweeper, and minute scheduler. |
| **Testing & Quality Assurance** | **8.5 / 10** | 89 test suites comprising >600 unit/integration tests and 19 Playwright E2E specs, including security permission matrix scanning and accessibility regression checks. |
| **Production Readiness (Infrastructure)** | **5.0 / 10** | **CRITICAL GAP**: Every external third-party integration (Meta WhatsApp Cloud API, OpenAI LLM, Razorpay Payments, AWS KMS, Cloudflare Turnstile, Amazon SES) has been built against mock/offline providers. No live provider verification has been performed in a production VPC. |

---

## 3. Overall Product Assessment

LeadPilot AI is **architecturally solid, functionally complete in local simulation, but operationally unverified against live external cloud providers**.

- **Strengths**: The foundational engineering is exceptional. RLS tenant isolation, transactional outbox relays, granular permissions, envelope encryption, and automated testing are built to tier-1 enterprise standards rarely seen before Series A.
- **Weaknesses**: The business logic heavily relies on simulated abstractions (`MockBillingProvider`, `MockLlm`, `MockTurnstileService`, simulated WhatsApp webhook feeds). The platform cannot be launched to paying customers until live provider integration is proven under production conditions.

---

## 4. Major Risks & Vulnerabilities

### A. Operational & External Provider Risks (Critical)
1. **Unverified Third-Party Provider APIs**:
   - Meta WhatsApp Cloud API: Written to Meta v21.0 specs, but live webhook payload variations, rate-limiting HTTP headers, media download authentication, and Meta template approvals have never touched live Meta servers.
   - Razorpay Subscriptions: Webhook verification uses real HMAC-SHA256, but live mandate processing, 3D Secure redirects, and failure handling are unverified.
   - OpenAI Integration: Token usage, strict JSON function calling latency, and response filtering have only run against a deterministic regex rule-engine (`MockLlm`).
2. **AWS KMS & Key Lifecycle**: Local development uses a 32-byte local master key. The KMS envelope wrapper (`awsKmsClient`) has not been executed against an active AWS IAM role or KMS Customer Master Key.

### B. Scalability Bottlenecks (High)
1. **Single-Worker Serial Minute Scheduler**: Background maintenance jobs (`apps/api/src/ops/scanners.service.ts`) scan tenant SLA breaches, inactivity, and reminders by iterating sequentially across active tenants. At >1,000 active workspaces, this loop will drift beyond the 60-second window.
2. **Outbox Table Contention**: High-frequency inbound message storms and automation runs contend on the `outbox_events` table using row-level locks (`FOR UPDATE SKIP LOCKED`).
3. **Database Transaction Pooling Limitations**: Because `withTenant()` uses PostgreSQL session configuration (`SELECT set_config('app.tenant_id', ...)`), application traffic requires transaction-level connection pooling (e.g., PgBouncer transaction mode) and cannot tolerate connection reuse across concurrent async queries on a single client connection.

### C. Product & Business Logic Gaps (Medium-High)
1. **Absence of Two-Way Calendar Integration**: While LeadPilot has an internal appointments engine, it completely lacks two-way sync with Google Calendar or Microsoft Outlook, leading to double-booking risks against sales reps' external personal schedules.
2. **No Inbound Email / SMS Channel**: Inbound communication is solely WhatsApp and Website Widget. Traditional email lead capture and SMS are missing.
3. **Absence of Native Lead Ad Integrations**: Real estate lead generation relies heavily on Meta Lead Ads and Google Ads. Leads currently must enter via generic API keys or manual CSV imports.

---

## 5. Key Recommendations & Next Steps

1. **Immediate Execution of Provider Verification (Sprint 1)**:
   - Connect live Meta WhatsApp Business Account (WABA) sandbox and verify inbound/outbound webhooks, media payloads, and template synchronization.
   - Execute live Razorpay test-mode transactions, subscriptions, and webhook dunning flows.
   - Validate OpenAI `gpt-4o-mini` with real embeddings (`text-embedding-3-small`) and evaluate hallucination rates against Indian real-estate domain prompts.
2. **Deploy to AWS Staging Infrastructure (Sprint 2)**:
   - Provision AWS ECS Fargate, RDS PostgreSQL 17 (with `pgvector`), ElastiCache Redis, S3, and AWS KMS as defined in `infrastructure/ecs-fargate-reference.md`.
   - Validate AWS KMS envelope encryption re-wrapping.
3. **Enterprise & Scalability Hardening (Sprint 3)**:
   - Shard the minute scheduler per tenant partition to allow multi-worker horizontal scaling.
   - Implement Google Calendar 2-way appointment synchronization.
   - Introduce native webhook connectors for Meta Lead Ads and Zapier/Make.
