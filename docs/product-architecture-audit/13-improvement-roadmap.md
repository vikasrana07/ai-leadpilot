# Prioritized Engineering & Product Roadmap: LeadPilot AI

This roadmap outlines an execution plan structured into four sequential phases, taking LeadPilot AI from its current locally-verified state to a scalable, commercially viable enterprise SaaS platform.

### Estimation Assumptions:
- Sizing is calculated in **Engineering Days (ED)** for a senior full-stack / backend engineer familiar with TypeScript, NestJS, PostgreSQL, and AWS.
- Assumes a standard staging environment running on AWS with live third-party credentials.

---

## Phase 1: Critical Issues & Launch Blockers (Weeks 1–3)

Focus: Eliminating production blockers, verifying live cloud providers, and establishing AWS staging infrastructure.

```
┌────────────────────────────────────────────────────────────────────────┐
│             PHASE 1: CRITICAL ISSUES & LAUNCH BLOCKERS                 │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Live Meta WhatsApp Verification        (5 ED)  - P0 Blocker         │
│ 2. Live Razorpay Subscriptions Testing     (4 ED)  - P0 Blocker         │
│ 3. Live OpenAI LLM & RAG Verification      (4 ED)  - P0 Blocker         │
│ 4. AWS Staging Provisioning & KMS Envelope (5 ED)  - P0 Blocker         │
│ 5. Strict Nonce-based CSP for Next.js      (3 ED)  - P1 High            │
└────────────────────────────────────────────────────────────────────────┘
Total Phase 1 Effort: 21 Engineering Days
```

### Initiative 1.1: Live Meta WhatsApp Cloud API Verification
- **Problem**: WhatsApp messaging has only run against an in-memory mock client (`WHATSAPP_MODE=mock`). Live webhook nuances, media download signatures, and template sync are unverified.
- **Solution**: Configure a verified Meta Tech Provider test app and WABA phone number. Execute live inbound/outbound text and template sends, verifying webhook signature validation in staging.
- **Business Value**: Essential for product launch; core customer communication channel.
- **Dependencies**: Meta Business Account approval.
- **Priority**: P0 (Blocker) | **Effort**: 5 ED | **Risk**: Low-Medium (Meta review delays).
- **Acceptance Criteria**: Live inbound WhatsApp message from a real phone creates a lead in the database and receives an automated reply within 3 seconds.

### Initiative 1.2: Live Razorpay Subscription Lifecycle Testing
- **Problem**: Billing integration is verified using `MockBillingProvider`. Live 3D-Secure card mandates, UPI auto-pay, and Razorpay webhook retries are unverified.
- **Solution**: Configure Razorpay Test Mode credentials (`RAZORPAY_MODE=live`). Run complete upgrade, downgrade, dunning, and cancellation test flows.
- **Business Value**: Enables self-service revenue collection and subscription monetization.
- **Dependencies**: Razorpay merchant onboarding.
- **Priority**: P0 (Blocker) | **Effort**: 4 ED | **Risk**: Low.
- **Acceptance Criteria**: Real test payment transitions workspace plan, generates sequential GST invoice, and updates plan entitlements.

### Initiative 1.3: Live OpenAI LLM & Vector Retrieval Validation
- **Problem**: AI Orchestrator currently runs against a deterministic regex rule-engine (`MockLlm`). Real LLM prompt adherence, Indian real-estate terminology, and strict tool-calling latency are unmeasured.
- **Solution**: Connect OpenAI API (`AI_PROVIDER=openai`, `gpt-4o-mini`, `text-embedding-3-small`). Run the 13 live-eval benchmark prompts and measure p95 latency and token consumption.
- **Business Value**: Guarantees intelligent, non-hallucinating sales interactions.
- **Dependencies**: OpenAI API Key.
- **Priority**: P0 (Blocker) | **Effort**: 4 ED | **Risk**: Medium (Prompt tuning required).
- **Acceptance Criteria**: AI answers property questions from PDF knowledge base and correctly extracts buyer budget/timeline into structured lead fields.

### Initiative 1.4: AWS Infrastructure Deployment & KMS Master Key Verification
- **Problem**: Deployments have only been executed locally via Docker Compose with a local master key.
- **Solution**: Provision AWS ECS Fargate, Aurora PostgreSQL 17, ElastiCache Redis, and AWS KMS via Terraform/CloudFormation (`infrastructure/ecs-fargate-reference.md`). Verify KMS key wrapping.
- **Business Value**: Secure, production-grade cloud hosting environment.
- **Dependencies**: AWS Account & IAM permissions.
- **Priority**: P0 (Blocker) | **Effort**: 5 ED | **Risk**: Low.
- **Acceptance Criteria**: API boots on ECS Fargate, connects to Aurora PostgreSQL with RLS, and encrypts secrets via AWS KMS HSMs.

### Initiative 1.5: Strict Dynamic Nonce-based CSP on Next.js
- **Problem**: CSP currently permits `'unsafe-inline'` script execution.
- **Solution**: Implement Next.js middleware injecting cryptographic nonces into `<script>` tags, enforcing strict script execution policies.
- **Business Value**: Fortifies platform against Cross-Site Scripting (XSS).
- **Dependencies**: None.
- **Priority**: P1 (High) | **Effort**: 3 ED | **Risk**: Low.
- **Acceptance Criteria**: Security headers test confirms `'unsafe-inline'` is removed without breaking React client hydration.

---

## Phase 2: Architectural Improvements & Optimization (Weeks 4–6)

Focus: Database optimization, worker specialization, and service refactoring.

```
┌────────────────────────────────────────────────────────────────────────┐
│             PHASE 2: ARCHITECTURAL IMPROVEMENTS                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Decompose Worker into Specialized Tiers (4 ED)  - P1 High           │
│ 2. Shard Minute Scheduler Per Tenant Hash  (3 ED)  - P1 High           │
│ 3. Database Exclusion Constraint for Cal   (2 ED)  - P1 High           │
│ 4. Refactor ConversationsService & Ops     (4 ED)  - P2 Medium         │
│ 5. SSRF DNS Re-binding Hardening           (2 ED)  - P2 Medium         │
└────────────────────────────────────────────────────────────────────────┘
Total Phase 2 Effort: 15 Engineering Days
```

### Initiative 2.1: Decompose Worker into Specialized Execution Tiers
- **Problem**: A heavy document parsing task can block the outbox relay in the single worker process.
- **Solution**: Split ECS task definitions into two containers: `worker-outbox` (real-time dispatch) and `worker-ai` (document parsing, embeddings, ClamAV).
- **Business Value**: Guarantees sub-second WhatsApp delivery even during heavy document uploads.
- **Priority**: P1 | **Effort**: 4 ED | **Acceptance Criteria**: Large 50MB PDF upload causes 0ms jitter in outbox WhatsApp message dispatching.

### Initiative 2.2: Shard Minute Maintenance Scheduler
- **Problem**: Serial iteration over all active tenants will not scale past 500 tenants.
- **Solution**: Partition tenant scanning using modulus hashing over worker task IDs.
- **Business Value**: Eliminates the 60-second scheduler drift risk as tenant count expands.
- **Priority**: P1 | **Effort**: 3 ED | **Acceptance Criteria**: Scheduler executes in <5 seconds across 2,000 simulated workspaces.

### Initiative 2.3: Database-Level Exclusion Constraint for Appointments
- **Problem**: Calendar conflict checking relies on application-level locks.
- **Solution**: Add PostgreSQL `btree_gist` extension and a `tstzrange` exclusion constraint on `appointments(user_id, range)`.
- **Business Value**: Absolute, database-enforced prevention of double-booking races.
- **Priority**: P1 | **Effort**: 2 ED | **Acceptance Criteria**: 20 concurrent booking requests for the exact same agent slot result in exactly 1 success and 19 409 Conflict errors.

---

## Phase 3: Product Completeness & Integrations (Weeks 7–10)

Focus: Eliminating functional product gaps that hinder sales conversions.

```
┌────────────────────────────────────────────────────────────────────────┐
│             PHASE 3: PRODUCT COMPLETENESS & INTEGRATIONS               │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Google Calendar Two-Way Sync            (8 ED)  - P0 Blocker        │
│ 2. Meta Lead Ads Webhook Ingestion         (5 ED)  - P0 Blocker        │
│ 3. WhatsApp Embedded Signup UI Flow        (6 ED)  - P1 High           │
│ 4. Real Estate Portal Email Parser         (5 ED)  - P1 High           │
│ 5. Zapier / Make Integration App           (4 ED)  - P2 Medium         │
└────────────────────────────────────────────────────────────────────────┘
Total Phase 3 Effort: 28 Engineering Days
```

### Initiative 3.1: Two-Way Google Calendar Synchronization
- **Problem**: Leads book slots that conflict with agents' external personal calendars.
- **Solution**: Build OAuth2 Google Calendar connector; query Free/Busy blocks during slot lookup; push booked appointments to Google Calendar.
- **Business Value**: Eliminates rep scheduling conflicts and missed meetings.
- **Priority**: P0 | **Effort**: 8 ED | **Acceptance Criteria**: An event added to an agent's Google Calendar immediately blocks out that time slot in LeadPilot.

### Initiative 3.2: Meta Lead Ads Direct Webhook Ingestion
- **Problem**: Ad leads require manual CSV export from Facebook Ads Manager.
- **Solution**: Subscribe to Meta `leadgen` webhooks, decrypt lead gen payloads, and automatically inject prospects into the CRM pipeline.
- **Business Value**: Enables real-time, sub-minute engagement for high-intent paid ad leads.
- **Priority**: P0 | **Effort**: 5 ED | **Acceptance Criteria**: Submitting a test Facebook Lead Ad form instantly triggers a welcome WhatsApp message from LeadPilot.

### Initiative 3.3: WhatsApp Embedded Signup Self-Service UI
- **Problem**: Agency owners struggle with manual Meta Cloud API token configuration.
- **Solution**: Implement the Meta Embedded Signup JavaScript SDK popup flow (`ADR-0012`).
- **Business Value**: Reduces workspace onboarding time from hours to minutes.
- **Priority**: P1 | **Effort**: 6 ED | **Acceptance Criteria**: Business owner connects their WhatsApp Business phone number via Facebook OAuth popup in under 3 minutes.

---

## Phase 4: Scalability & Enterprise Readiness (Weeks 11–14)

Focus: High-throughput data partitioning, marketing campaigns, and enterprise features.

```
┌────────────────────────────────────────────────────────────────────────┐
│             PHASE 4: SCALABILITY & ENTERPRISE READINESS                │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Month-Partitioning for Messages Table   (5 ED)  - P2 Medium         │
│ 2. Outbound WhatsApp Broadcast Campaigns   (8 ED)  - P2 Medium         │
│ 3. Custom Role Builder UI                  (4 ED)  - P3 Low            │
│ 4. CloudWatch EMF Dashboard & Runbooks     (4 ED)  - P2 Medium         │
└────────────────────────────────────────────────────────────────────────┘
Total Phase 4 Effort: 21 Engineering Days
```

---

## Roadmap Summary & Resource Allocation

| Phase | Duration | Core Focus | Engineering Effort |
|---|---|---|:---:|
| **Phase 1** | Weeks 1–3 | Live Provider Verification & AWS Staging | 21 Days |
| **Phase 2** | Weeks 4–6 | Architecture Hardening & Specialization | 15 Days |
| **Phase 3** | Weeks 7–10 | External Integrations (Calendar, Ads, WABA) | 28 Days |
| **Phase 4** | Weeks 11–14 | Enterprise Scale & Marketing Capabilities | 21 Days |
| **TOTAL** | **14 Weeks** | **Production-Ready Enterprise Platform** | **85 Engineering Days** |
