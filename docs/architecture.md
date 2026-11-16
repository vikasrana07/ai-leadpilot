# LeadPilot AI — Architecture (Phase 0 draft)

Status: **DRAFT, awaiting approval.** Source of truth for requirements: `MASTER_PROMPT.md`. Decisions are recorded in `docs/decisions/`.

## 1. Repository state

The repository at Phase 0 start contained only `MASTER_PROMPT.md` (no git repo, no code). Nothing existing to reuse or preserve. `git init` happens at the start of Phase 1 (needs user go-ahead, see open questions).

## 2. Style: modular monolith

One deployable API, one worker, one web app. Modules are NestJS modules with explicit public interfaces. Rules:

- A module never reads or writes another module's tables directly; it calls that module's exported service or reacts to a domain event.
- Cross-module side effects go through the **transactional outbox** (ADR-0004), not direct calls, wherever eventual consistency is acceptable (automations, notifications, analytics rollups).
- Enforced by lint (`eslint-plugin-boundaries` or Nx-style import rules; decision in Phase 1) so extraction to services later is mechanical.

```
            ┌──────────────┐   REST + SSE    ┌───────────────────────────┐
 Browser ──▶│ apps/web     │────────────────▶│ apps/api (NestJS)         │
 Widget  ──▶│ Next.js      │                 │  modules (see §3)         │
            └──────────────┘                 │  guards: auth→tenant→perm │
 Meta   ───── webhooks ─────────────────────▶│  outbox writer            │
 Razorpay ─── webhooks ─────────────────────▶└──────┬─────────────┬──────┘
                                                    │             │
                                       Postgres+pgvector        Redis
                                       (RLS, outbox)         (BullMQ, rate-limit, SSE fan-out)
                                                    ▲             ▲
                                            ┌───────┴─────────────┴───────┐
                                            │ apps/worker                 │
                                            │ same modules, queue         │
                                            │ processors only             │
                                            │ (AI, automations, doc proc, │
                                            │  outbound WhatsApp, rollups)│
                                            └─────────────────────────────┘
                                    S3-compatible storage (tenant-prefixed) · ClamAV
```

`apps/worker` imports the same Nest modules as `apps/api` but bootstraps without an HTTP listener, so business logic exists once.

## 3. Modules

Grouped from the 30 modules in the brief. Phase in brackets is when it is first built.

| Group | Modules | Phase |
|---|---|---|
| Identity | Authentication, Users, Memberships, Roles & Permissions, Audit Logs | 1 |
| Tenancy | Tenants (incl. onboarding state, Industry Pack binding), Platform Administration | 1 / 6 |
| CRM | Leads, Lead Sources, Lead Activities, Lead Scoring, Sales Pipeline, Properties (inventory) | 2 |
| Comms | Channels, WhatsApp Integration, Website Chat, Conversations, Messages | 3 |
| AI | AI Assistant, AI Agents (orchestrator + tools), Knowledge Base, Document Processing | 4 |
| Ops | Appointments, Automation Engine, Notifications, SLA | 5 |
| Insight | Analytics, Reports, Usage Tracking | 2 / 4 / 6 |
| Commerce | Subscriptions, Billing, Integrations | 6 |

"AI Agents" in the brief is interpreted as the orchestration layer plus the tool registry, not multiple autonomous agents (ADR-0007).

## 4. Request lifecycle and tenant context

1. `AuthGuard` validates the access token → `userId`, `sessionId`.
2. `TenantGuard` resolves the active membership (workspace chosen by a signed session claim or the `X-Workspace` header which is **only a hint to select among the user's own memberships**, never trusted as an identifier) → `tenantId`, `role`, `permissions`.
3. `PermissionGuard` checks the endpoint's required permission key(s) and scope (`own` vs `all`).
4. A request-scoped transaction opens; `SET LOCAL app.tenant_id = '<uuid>'` is executed first; all queries in the request go through that transaction.
5. Zod validates input; the handler calls services; services never accept `tenantId` from DTOs.
6. Audit and outbox rows are written in the same transaction.

Jobs: payload includes `tenantId`; the processor wrapper validates it, opens a transaction, sets `app.tenant_id`, then runs. A job without `tenantId` fails fast.

Public endpoints (widget, webhooks, lead-capture API) resolve tenant from a public key / phone-number-ID / API key lookup server-side, then follow the same transaction rule.

Platform admin: separate auth surface and a separate DB role with an explicit, audited path; see ADR-0003.

## 5. Real-time

SSE from the API, one stream per authenticated session, scoped to the tenant. Redis pub/sub fans out events from worker to API instances. WebSocket only if SSE proves insufficient (ADR-0006).

## 6. AI architecture

```
inbound message ─▶ queue(ai.respond, tenantId, conversationId, messageId)
   worker: lock conversation (one in-flight AI turn per conversation)
     ├─ mode check: human takeover? → skip
     ├─ budget check: tenant AI cap exceeded? → fallback + handover
     ├─ load context window + lead snapshot (server-side)
     ├─ retrieve: pgvector (tenant-filtered) for FAQs/docs; SQL services for structured facts
     ├─ LLM call via LlmProvider (structured output + tools)
     │     tool call → ToolRegistry → zod validate → permission/tenant bind → idempotency key → service → audit
     ├─ output validation (no claims outside retrieved/DB facts; policy checks)
     ├─ persist message, lead updates, score, usage row, execution trace
     └─ outbound via WhatsApp/widget service (window/template rules enforced there)
```

- Customer text and retrieved document text are untrusted: delimited, never interpreted as instructions, and the tool layer re-validates everything regardless of what the model asks for.
- Tenant ID for every tool is taken from job context; the model cannot supply or alter it.
- Prompts are versioned; each AI turn stores prompt version, model, token counts, tool calls, retrieved chunk IDs and latency.
- An eval harness (golden conversations) gates Phase 4.

## 7. Messaging rules (WhatsApp)

- Webhook endpoint: verify signature, persist raw event + dedupe key, enqueue, return 200 in <1s.
- Outbound goes through a single `OutboundMessageService` that checks: opt-in status, 24-hour window (free-form allowed) vs template-only, per-tenant rate/tier limits, idempotency. Rejections are explicit errors visible to the user/automation, never silently dropped.
- Message status webhooks update delivery state; out-of-order events handled by monotonic status ordering.

## 8. Data layer

See `docs/database-schema.md` for the entity outline. Key conventions are in `MASTER_PROMPT.md` §B3. Highlights: UUIDv7 keys, `tenant_id` + RLS on every tenant table, soft delete for leads/conversations, UTC timestamps, E.164 phones, integer minor-unit money, HNSW vector index, expand/contract migrations, exclusion constraint for appointment overlap.

## 9. Security summary

Defence in depth for tenancy (guard → scoped data access → RLS), argon2id, rotating refresh tokens with reuse detection, envelope-encrypted integration secrets, signed/idempotent webhooks, presigned tenant-prefixed file access, append-only audit, AI tool allowlisting. Full list in `MASTER_PROMPT.md` §B2. A threat model document is a Phase 1 deliverable (`docs/threat-model.md`).

## 10. Deployment (reference)

Local: Docker Compose (Postgres+pgvector, Redis, MinIO, ClamAV, Mailpit). Production reference: ECS/Fargate (api, worker, web), RDS Postgres, ElastiCache, S3, KMS, Secrets Manager, CloudFront, GitHub Actions. Details in Phase 7.

## 11. Pinned versions (verified against the npm registry on 2026-11-16)

Exact pinning happens in lockfiles in Phase 1. Starting targets:

| Package | Version | Note |
|---|---|---|
| Node | 22 LTS (local: v22.23.4) | |
| pnpm | 11.x (local 11.5.1) | |
| Next.js | 16.4.6 | App Router |
| React | 19.3.1 | |
| TypeScript | **6.0.3** | Not 7.x: see ADR-0008 |
| Tailwind CSS | 4.3.5 | |
| NestJS | 12.5.0 | `latest` tag; Phase 1 spike must confirm ecosystem compatibility, fallback 11.2.10 |
| Prisma (client + CLI) | **7.10.1** | `latest` tag is 8.0.0-rc.33 (release candidate), not used. See ADR-0008 |
| BullMQ | 6.7.6 | |
| ioredis | 6.0.0 | |
| Zod | 4.6.7 | |
| motion | 14.14.0 | |
| TanStack Query | 5.107.1 | |
| Recharts | 3.10.1 | |
| React Hook Form | 7.92.0 | |
| Zustand | 5.1.0 | |
| lucide-react | 1.73.0 | |
| Turborepo | 2.11.11 | |
| Vitest | 5.1.0 | |
| Playwright | 1.65.1 | |
| openai (SDK) | 7.57.0 | behind `LlmProvider` |
| Postgres | 17 + pgvector | image pinned in Phase 1 |

shadcn/ui is copied source, not a versioned dependency. Versions above are what the registry reports today; I have not yet installed or built anything with them, so compatibility is **unverified** until the Phase 1 spike.

## 12. Open questions for the user

See `PROGRESS.md` → "Decisions needed".
