# Product Discovery & Business Understanding: LeadPilot AI

## 1. Product Vision & Value Proposition

**LeadPilot AI** is an intelligent, multi-tenant B2B SaaS platform designed to automate the entire top-of-funnel and mid-funnel sales lifecycle. 

In traditional high-value, consideration-heavy sales environments (such as Indian real estate agencies, higher education admissions, and elective medical clinics), lead conversion rates fail primarily due to three operational friction points:
1. **Response Latency**: Enquiries arriving via WhatsApp or website forms outside business hours or during high-traffic peaks wait hours or days for a response, resulting in lead decay.
2. **Rep Disqualification Overhead**: Up to 70% of inbound leads are unqualified (insufficient budget, out-of-scope geography, tire-kickers), wasting costly sales agent bandwidth.
3. **Dropped Follow-ups**: Fragmented manual record-keeping across personal WhatsApp accounts and disparate spreadsheets leads to lost sales opportunities.

**LeadPilot’s Mission**: *"Never lose a potential customer because of a missed enquiry, delayed response, or forgotten follow-up."*

LeadPilot acts as an autonomous frontline sales assistant that instantly engages inbound leads 24/7 over their preferred channel (primarily WhatsApp), answers nuanced inquiries using organizational knowledge, qualifies prospective buyers, schedules appointments, routes qualified opportunities to human agents, and triggers automated follow-up sequences.

---

## 2. Target Market & Customer Segments

### Primary Target Segment: Indian Real Estate Agencies
- **Firm Profile**: Real estate developers, channel partners, and boutique brokerages handling residential apartments, commercial plots, and luxury villas.
- **Operating Geography**: Tier-1 and Tier-2 Indian metropolitan markets (Mumbai MMR, Bengaluru, Delhi NCR, Pune, Hyderabad, Chennai).
- **Core Market Needs**: Support for Indian vernaculars/Hinglish, financial terminology (INR Lakhs/Crores, sq. ft., RERA compliance, carpet area), rapid lead distribution across rotating sales teams, and WhatsApp-native communication.

### Secondary Segments (Supported via Modular "Industry Packs"):
- **Coaching & EdTech Institutes**: Managing course inquiries, fee structures, batch timings, demo class bookings, and entrance test counselling.
- **Elective Healthcare & Clinics**: Dental clinics, cosmetic dermatology, and wellness centers managing consultation fees, doctor availability, and treatment package bookings.
- **Home Services**: Interior design studios, solar installations, and renovations requiring site visits, scope estimation, and quotation follow-ups.

---

## 3. User Personas & Organizational Roles

| Persona / Role | Description & Primary Goals | Key Platform Responsibilities |
|---|---|---|
| **Platform Super Admin** (`PlatformAdmin`) | Operator of the SaaS platform. Manages tenant health, billing plans, compliance, and platform operations. | Workspace suspension/activation, manual plan assignment, viewing system-wide metrics, emergency read-only tenant impersonation, monitoring health snapshots. |
| **Business Owner** (`owner`) | Agency principal, managing director, or business founder. Focuses on revenue, lead conversion velocity, and ROI. | Workspace creation and configuration, billing and subscription management, team invitation and role assignment, AI knowledge base curation, SLA rules definition. |
| **Sales Manager** (`manager`) | Team lead or sales director supervising day-to-day rep performance and pipeline throughput. | Pipeline stage management, manual lead assignment and re-allocation, reviewing unassigned queues, monitoring SLA breaches, configuring automation workflows, viewing team analytics. |
| **Sales Agent** (`agent`) | Individual sales representative closing deals and conducting customer meetings. | Interacting with assigned leads via the unified inbox, taking over conversations from the AI, scheduling appointments, logging call notes, advancing lead stages. |
| **End Customer / Lead** (`Lead`) | Prospective buyer/client reaching out via WhatsApp, website widget, or customer portal. | Communicating needs, receiving instant property brochures/quotes, scheduling consultation appointments via one-time login links. |

---

## 4. Core Business Problems Solved

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TRADITIONAL FRAGMENTED PROCESS                        │
│                                                                             │
│ Inbound Lead  ──▶ Personal WhatsApp /  ──▶ Delayed Response ──▶ Lead Cools  │
│ (Any Channel)     Unshared Spreadsheets    (Hours / Days)       Down / Lost │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LEADPILOT AI OPERATIONAL PIPELINE                     │
│                                                                             │
│ Inbound Lead  ──▶ Instant AI Engagement ──▶ Vector Knowledge Retrieval      │
│ (WhatsApp/Web)    (< 2 seconds)             (RERA, Floor plans, Pricing)    │
│                                                          │                  │
│                                                          ▼                  │
│ Automated Appointment ◀── Round-Robin Assignment ◀── Lead Qualification &   │
│ & Follow-up Sequences     to Human Agent             Scoring (Hot/Warm/Cold)│
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Instant Top-of-Funnel Qualification**: The AI Assistant engages prospects within seconds, collecting budget, location, configuration, and timeline requirements.
2. **Knowledge Retrieval Without Hallucination**: RAG (Retrieval-Augmented Generation) pipeline ensures the AI only recommends verified inventory and pricing approved by the tenant.
3. **Deterministic Human Handover**: Automated escalation to human reps whenever a lead requests human intervention or triggers a "HOT" qualification score.
4. **Fair & Transparent Team Workload Routing**: Concurrency-safe round-robin allocation engine ensures leads are distributed evenly across active agents.
5. **No Double-Booking Appointment Scheduling**: Prevents rep calendar conflicts with automated WhatsApp reminders reducing no-show rates.

---

## 5. Main Product Modules & Business Capabilities

The platform comprises 8 primary domain modules encapsulating 30 distinct functional capabilities:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              LEADPILOT AI MODULES                            │
├─────────────────┬──────────────────┬───────────────────┬─────────────────────┤
│  1. IDENTITY    │  2. TENANCY      │  3. CRM CORE      │  4. COMMUNICATIONS  │
│  - Auth & MFA   │  - Onboarding    │  - Leads & Merge  │  - WhatsApp Cloud   │
│  - Roles (RBAC) │  - Industry Pack │  - Pipeline Kanban│  - Web Chat Widget  │
│  - Audit Logs   │  - Workspace Cfg │  - Inventory (Prop│  - Unified Inbox    │
├─────────────────┼──────────────────┼───────────────────┼─────────────────────┤
│  5. AI ENGINE   │  6. OPS & SCHED  │  7. ANALYTICS     │  8. SAAS & BILLING  │
│  - Assistant    │  - Appointments  │  - Dashboard KPIs │  - Subscriptions    │
│  - Vector RAG   │  - DAG Automation│  - Reports & CSV  │  - GST Invoicing    │
│  - Lead Scoring │  - SLA & Tasks   │  - CloudWatch EMF │  - Public API & WH  │
└─────────────────┴──────────────────┴───────────────────┴─────────────────────┘
```

### Module 1: Identity & Access Management (IAM)
- **Business Purpose**: Secure authentication, user management, and fine-grained access control.
- **Target Users**: All authenticated users and platform admins.
- **Features Implemented**: Email/password registration, secure JWT cookie authentication, session listing and revocation, TOTP-based Multi-Factor Authentication with recovery codes, invitation workflows with token preview.
- **Business Rules**:
  - Minimum 12-character passwords hashed with Argon2id.
  - Granular RBAC enforcing 32 distinct permissions. Agents are strictly row-scoped (`lead:read:own`) returning 404 for unauthorized records.
  - Workspace-level MFA enforcement holding non-enrolled users at `/security`.
- **Dependencies**: `@leadpilot/database`, `argon2`, `jose`, `turnstile`.
- **APIs**: `/auth/*`, `/security/mfa/*`, `/security/workspace/*`, `/team/*`, `/roles/*`.
- **Entities**: `User`, `Session`, `Membership`, `Role`, `Permission`, `RolePermission`, `Invitation`, `MfaCredential`, `MfaRecoveryCode`.
- **Maturity**: **Fully Implemented**.

### Module 2: Tenancy & Industry Customization
- **Business Purpose**: Multi-tenant data isolation and industry-specific business configuration.
- **Target Users**: Business Owners and Platform Super Admins.
- **Features Implemented**: Resumable multi-step onboarding wizard, tenant profile and timezone settings, Industry Pack system (Real Estate, Healthcare, Coaching, Home Services).
- **Business Rules**:
  - Tenants cannot see or mutate other tenants' records (enforced by PostgreSQL Row-Level Security).
  - Applying an Industry Pack dynamically populates default pipeline stages, custom field definitions, lost reasons, and scoring rules without overwriting tenant modifications.
- **Dependencies**: `@leadpilot/database`, `packages/shared-types/src/industry-packs.ts`.
- **APIs**: `/tenant`, `/tenant/onboarding`, `/tenant/assignment`.
- **Entities**: `Tenant`, `PipelineStage`, `LostReason`, `CustomFieldDefinition`, `ScoringRuleSet`.
- **Maturity**: **Fully Implemented**.

### Module 3: CRM Core (Leads, Pipeline, Inventory)
- **Business Purpose**: Managing customer relationships, tracking sales progression, and cataloging product inventory.
- **Target Users**: Sales Agents, Sales Managers, Business Owners.
- **Features Implemented**:
  - Lead CRUD with trigram-indexed search (name, email, phone).
  - Two-step CSV lead import with dry-run validation, Indian currency string normalization (`85 L` -> 8,500,000; `1.5 Cr` -> 15,000,000).
  - Duplicate detection engine with interactive lead merge and activity history consolidation.
  - Drag-and-drop Pipeline Kanban board with server-enforced transition rules and lost-reason tracking.
  - Property inventory management with custom attribute filtering.
  - Round-robin lead assignment engine with concurrency locks.
- **Business Rules**:
  - Soft deletion on leads and properties (`deletedAt` automatically filtered by Prisma client extension).
  - Strict stage transition policies (e.g., preventing movement to `Won` or `Lost` without required qualification fields or lost reason).
- **Dependencies**: `@leadpilot/database`, `@leadpilot/validation`.
- **APIs**: `/leads/*`, `/pipeline/*`, `/properties/*`.
- **Entities**: `Lead`, `PipelineStage`, `StageTransition`, `LeadActivity`, `LeadNote`, `Tag`, `LeadTag`, `Property`, `LostReason`.
- **Maturity**: **Fully Implemented**.

### Module 4: Omnichannel Communication & Unified Inbox
- **Business Purpose**: Centralizing all customer conversations into a single collaborative workspace.
- **Target Users**: Sales Agents and Sales Managers.
- **Features Implemented**:
  - 3-pane responsive unified inbox with conversation queues (`Unassigned`, `Mine`, `All`, `Bot`).
  - WhatsApp Cloud API integration (message sending, template management, webhook intake).
  - Embeddable website chat widget (`/widget.js`) with custom theme and origin allow-listing.
  - Real-time live messaging over Server-Sent Events (SSE) backed by Redis pub/sub.
  - Customer consent tracking and 24-hour customer service window enforcement.
  - Human takeover mechanism disabling AI automation for active rep conversations.
- **Business Rules**:
  - Outbound freeform messages outside Meta's 24-hour messaging window are blocked; only pre-approved WhatsApp templates are permitted.
  - Inbound opt-out messages (`STOP`, `UNSUBSCRIBE`) immediately set consent to `OPTED_OUT` and stop automated outreach.
- **Dependencies**: `ioredis`, `@leadpilot/database`, `crypto/secret-box.ts`.
- **APIs**: `/conversations/*`, `/channels/*`, `/whatsapp/templates/*`, `/webhooks/whatsapp/*`, `/widget-config/*`, `/realtime/stream`.
- **Entities**: `Channel`, `Conversation`, `Message`, `ConversationNote`, `Consent`, `WhatsappTemplate`, `WidgetConfig`, `IntegrationCredential`.
- **Maturity**: **Partially Implemented (Live Meta client unverified; tested with mock provider)**.

### Module 5: AI Sales Assistant & Knowledge Retrieval (RAG)
- **Business Purpose**: Autonomous lead engagement, RERA/brochure question answering, and automated lead scoring.
- **Target Users**: Automated backend system, monitored by Sales Managers.
- **Features Implemented**:
  - AI Assistant orchestrator supporting tool execution (`search_properties`, `schedule_appointment`, `handover_to_human`, `qualify_lead`).
  - Multi-format document parser (PDF via `unpdf`, Word via `mammoth`, plain text) with ClamAV virus scanning.
  - Vector chunking and embedding storage using PostgreSQL `pgvector` (`text-embedding-3-small`, 1536 dimensions).
  - Configurable lead scoring engine aggregating demographic, behavioral, and engagement signals.
- **Business Rules**:
  - Hard token caps per tenant per month to prevent LLM bill shocks.
  - Grounded time guard preventing the AI from fabricating invalid calendar appointment slots.
  - Document parsing runs in isolated background processes to prevent memory/CPU starvation.
- **Dependencies**: `unpdf`, `mammoth`, `@aws-sdk/client-s3`, `pgvector`, ClamAV.
- **APIs**: `/ai-assistant/*`, `/knowledge/*`.
- **Entities**: `AiAssistant`, `AiRun`, `AiToolExecution`, `KnowledgeDocument`, `KnowledgeChunk`, `ScoringRuleSet`, `LeadScore`.
- **Maturity**: **Partially Implemented (Offline Mock/rule engine verified; OpenAI client written but unverified)**.

### Module 6: Operations, Scheduling & Visual Automation
- **Business Purpose**: Executing background business logic, appointment scheduling, SLA tracking, and workflow automation.
- **Target Users**: Sales Agents, Managers, Automated Workers.
- **Features Implemented**:
  - Multi-rep appointment calendar with conflict detection and automated WhatsApp confirmations.
  - Visual DAG Automation Builder (`@xyflow/react` canvas + accessible Outline editor) supporting triggers, conditional branching, time delays, and actions.
  - Background outbox relay (`FOR UPDATE SKIP LOCKED`) driving asynchronous BullMQ jobs.
  - SLA breach monitoring and internal notification alerts.
- **Business Rules**:
  - Mutual recursion loop protection capping chained automation runs at 14 execution steps.
  - Concurrent booking protection: atomic transaction checks ensure no two appointments can claim the same rep slot.
- **Dependencies**: `bullmq`, `ioredis`, `@xyflow/react`, `apps/worker`.
- **APIs**: `/appointments/*`, `/automations/*`, `/tasks/*`, `/sla/*`, `/notifications/*`.
- **Entities**: `Appointment`, `AvailabilityRule`, `Automation`, `AutomationVersion`, `AutomationRun`, `Task`, `Notification`, `SlaBreach`, `OutboxEvent`.
- **Maturity**: **Fully Implemented (Engine verified with local BullMQ + Redis)**.

### Module 7: SaaS Subscriptions, Invoicing & Commercialization
- **Business Purpose**: Monetizing the software, managing subscription tiers, generating tax invoices, and gating features.
- **Target Users**: Business Owners, Billing Admins, Platform Admins.
- **Features Implemented**:
  - Subscription tier enforcement (Free, Starter, Growth, Enterprise).
  - Indian GST-compliant invoice generation (with SAC code `998314`, CGST+SGST or IGST depending on state code).
  - Razorpay subscription lifecycle management (plan creation, subscription, upgrade/downgrade, cancellation).
  - Automated feature gating (`RequireFeature` decorator) checking database-backed entitlements.
- **Business Rules**:
  - Invoices are immutable once finalized and carry sequential legal invoice numbers.
  - Grace period (7 days) on failed payments before workspace feature suspension.
- **Dependencies**: `@leadpilot/database`, `packages/validation/src/billing.ts`.
- **APIs**: `/billing/*`, `/webhooks/razorpay`, `/platform/plans/*`.
- **Entities**: `Plan`, `PlanEntitlement`, `Subscription`, `BillingProfile`, `Invoice`, `Payment`, `BillingEvent`, `InvoiceCounter`.
- **Maturity**: **Partially Implemented (Live Razorpay client unverified; tested with mock provider)**.

### Module 8: Public API, Webhooks & Developer Platform
- **Business Purpose**: Enabling external developers, CRM sync, and enterprise systems integration.
- **Target Users**: Enterprise Developers, Technical Integration Partners.
- **Features Implemented**:
  - Public REST API under `/v1` guarded by hashed API keys.
  - Outbound transactional webhooks with HMAC-SHA256 signatures, exponential backoff retries, and SSRF-safe HTTP dispatch.
  - Customer Self-Service Portal (`/portal`) with passwordless code authentication.
- **Business Rules**:
  - SSRF protection: outbound webhooks strictly prohibit private RFC-1918 IPs, loopbacks, and cloud metadata endpoints in production.
  - Strict idempotency key handling (`Idempotency-Key` header) on mutation endpoints.
- **Dependencies**: `apps/api/src/common/safe-http.ts`, `apps/api/src/v1/*`.
- **APIs**: `/v1/*`, `/webhooks/*`, `/portal/*`.
- **Entities**: `ApiKey`, `WebhookEndpoint`, `WebhookDelivery`, `PortalConfig`, `PortalSession`, `IdempotencyKey`.
- **Maturity**: **Fully Implemented**.

---

## 6. Implementation Maturity Classification

| Feature Classification | Modules & Capabilities |
|---|---|
| **Fully Implemented & Verified** | • Multi-tenant RLS Isolation<br>• Authentication, Sessions & TOTP MFA<br>• Granular RBAC (32 permissions)<br>• Lead Management, Deduplication & Merging<br>• Pipeline Kanban & Stage Transition Rules<br>• Property Inventory<br>• Outbox Relay & BullMQ Job Queue<br>• Appointment Double-Booking Protection<br>• Visual Automation Canvas & DAG Engine<br>• GST Invoice PDF/Data Engine<br>• Public `/v1` REST API & Idempotency<br>• SSRF-Safe Outbound Webhooks<br>• Turnstile Bot Guard (code complete)<br>• Month-Partitioned Audit Logs |
| **Partially Implemented (Code Complete, Live Provider Unverified)** | • WhatsApp Cloud API Client (`apps/api/src/whatsapp/whatsapp.client.ts`)<br>• OpenAI LLM & Embeddings Client (`apps/api/src/ai/llm.ts`)<br>• Razorpay Subscriptions & Webhook Processing (`apps/api/src/billing/provider.ts`)<br>• AWS KMS Master Key Provider (`apps/api/src/crypto/secret-box.ts`)<br>• Cloudflare Turnstile Live Site-Verify (`apps/api/src/security/turnstile.ts`)<br>• Amazon SES / Production SMTP Delivery |
| **UI-Only / Sandbox Features** | • `/design/*` routes (`/design/dashboard`, `/design/inbox`, `/design/lead`, `/design/pipeline`): static visual sandboxes with mocked datasets used for design tokens review. |
| **Planned / Missing Features** | • Two-way Google Calendar & Outlook Calendar Sync<br>• Native Meta Lead Ads & Google Ads Webhook Ingestion<br>• Inbound/Outbound Email & SMS Channels<br>• WhatsApp Embedded Signup UI Flow<br>• Native Zapier / Make Integration App |
