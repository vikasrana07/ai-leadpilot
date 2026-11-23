# Technical Debt Register: LeadPilot AI

This register documents all technical debt, code smells, architectural liabilities, and operational risks identified across the LeadPilot AI repository.

---

## 1. Technical Debt Classification Matrix

| Debt ID | Category | Description & Technical Evidence | Location / File Path | Impact & Operational Risk | Remediation Effort | Priority |
|---|---|---|---|---|:---:|:---:|
| **DEBT-01** | **Integration** | **Unverified Live Provider Implementations**: Meta Cloud API, Razorpay Subscriptions, OpenAI LLM, and AWS KMS are coded but only executed against local mock doubles. | `apps/api/src/whatsapp/whatsapp.client.ts`<br>`apps/api/src/billing/provider.ts`<br>`apps/api/src/ai/llm.ts`<br>`apps/api/src/crypto/secret-box.ts` | **Critical**: Production launch will fail if real API responses, rate limits, or auth headers deviate from mock assumptions. | 8 Days | **P0 (Blocker)** |
| **DEBT-02** | **Scalability** | **Serial Tenant Scanning in Scheduler**: The minute maintenance scheduler loops sequentially over all active workspaces to calculate SLA breaches and inactive follow-ups. | `apps/api/src/ops/scanners.service.ts`<br>`apps/api/src/ops/jobs.service.ts` | **High**: At >500 active tenants, the scan loop will exceed 60 seconds, causing job queue starvation and overlapping cron ticks. | 3 Days | **P1 (High)** |
| **DEBT-03** | **Architecture** | **Single-Process Background Worker Monolith**: `apps/worker` runs outbox relays, minute maintenance, BullMQ consumers, and ClamAV document extraction in a single Node process. | `apps/worker/package.json`<br>`apps/api/src/worker.ts` | **High**: High-CPU PDF parsing can block the event loop, causing jitter in real-time WhatsApp message dispatching. | 4 Days | **P1 (High)** |
| **DEBT-04** | **Security** | **Next.js Inline Script Permissiveness in CSP**: Production CSP allows `'unsafe-inline'` for `script-src` to support Next.js inline bootstrap state. | `apps/web/next.config.ts`<br>`apps/web/app/layout.tsx` | **Medium-High**: Weakens XSS defense in rich-text chat and notes rendering. | 3 Days | **P1 (High)** |
| **DEBT-05** | **Data Integrity**| **Application-Level Calendar Conflict Checking**: Double-booking prevention relies on database transaction locks rather than DB-level exclusion constraints. | `apps/api/src/ops/appointments.service.ts` | **Medium**: Edge-case database race conditions under high concurrent booking volume could allow overlapping appointments. | 2 Days | **P1 (High)** |
| **DEBT-06** | **Code Quality** | **God Service: `ConversationsService`**: Monolithic service spanning ~800 lines handling chat threads, WhatsApp templates, opt-out logic, agent takeover, and outbox writes. | `apps/api/src/conversations/conversations.service.ts` | **Medium**: Low maintainability; high risk of regression when modifying chat or messaging features. | 3 Days | **P2 (Medium)** |
| **DEBT-07** | **Code Quality** | **Artificial Controller Split: `OpsController` vs `Ops2Controller`**: Arbitrary splitting of operational routes across two controller files without clean domain boundaries. | `apps/api/src/ops/ops.controller.ts`<br>`apps/api/src/ops/ops2.controller.ts` | **Low-Medium**: Architectural clutter; confusing route discovery for engineers. | 1.5 Days | **P2 (Medium)** |
| **DEBT-08** | **Security** | **DNS Re-binding Vulnerability in Outbound Webhooks**: `safeFetch` checks IP address prior to HTTP dispatch without pinning the resolved IP on the TCP socket. | `apps/api/src/common/safe-http.ts` | **Medium**: Potential SSRF vector to reach AWS internal metadata (`169.254.169.254`) via DNS TOCTOU timing attacks. | 2 Days | **P2 (Medium)** |
| **DEBT-09** | **Scalability** | **Unpartitioned `messages` Table**: Core messaging table stores raw text and delivery receipts without physical table partitioning. | `packages/database/prisma/schema.prisma` (`model Message`) | **Medium**: Performance will degrade over time as message volume reaches multi-million row scale. | 5 Days | **P2 (Medium)** |
| **DEBT-10** | **Database** | **Foreign Key to Inactive Workspace Members**: `Lead.assignedUserId` references `users(id)` without enforcing that the user has an `ACTIVE` membership in that workspace. | `packages/database/prisma/schema.prisma` (`model Lead`) | **Low-Medium**: Allows deactivated or removed employees to retain lead assignments. | 1 Day | **P2 (Medium)** |
| **DEBT-11** | **Testing** | **Missing Browser-Level Web Component Unit Tests**: `apps/web` contains only 13 test files, relying almost entirely on Playwright E2E for UI verification. | `apps/web/components/*` | **Low-Medium**: Slow test feedback loops during front-end component refactoring. | 4 Days | **P3 (Low)** |
| **DEBT-12** | **Observability**| **Unpropagated Distributed Request IDs**: The HTTP `x-request-id` is not injected into the `OutboxEvent` payload or passed through BullMQ jobs. | `apps/api/src/ops/outbox.service.ts` | **Low**: Difficult to trace a customer message failure back to the specific initiating HTTP request in CloudWatch. | 1.5 Days | **P3 (Low)** |

---

## 2. Technical Debt Remediation Burndown Strategy

To prevent technical debt from compounding during feature expansion, the engineering organization should adopt a **"20% Debt Allocation"** rule:
1. **Sprint 1 (Launch Blockers)**: Dedicate 100% of engineering bandwidth to resolving `DEBT-01` (Live Provider Implementations) and `DEBT-04` (CSP Script Nonces).
2. **Sprints 2–3 (Architecture Stabilization)**: Allocate 30% of sprint capacity to resolving `DEBT-02` (Scheduler Sharding), `DEBT-03` (Worker Separation), and `DEBT-05` (Calendar Exclusion Constraints).
3. **Sprints 4+ (Ongoing Hygiene)**: Burn down code-level items (`DEBT-06`, `DEBT-07`, `DEBT-12`) during routine module enhancements.
