# Architecture Decision Records: initial set (Phase 0)

Format: Context · Decision · Consequences. Status of all: **Proposed** until the user approves Phase 0.

---

## ADR-0001: Modular monolith with a separate worker process
**Context.** 30 modules, small team, need to ship; future extraction possible.
**Decision.** One NestJS codebase; `apps/api` (HTTP) and `apps/worker` (queue processors) share modules. Module boundaries enforced by lint.
**Consequences.** One deploy artifact per role, simple local dev, shared transactions where needed. Requires discipline on boundaries; lint rule is mandatory.

## ADR-0002: Tenant isolation via tenant-scoped transactions + PostgreSQL RLS
**Context.** Shared database, strict isolation requirement.
**Decision.** Every request/job runs in a transaction that issues `SET LOCAL app.tenant_id`. The app connects as a non-superuser, non-owner role, so RLS is not bypassed. Migrations run as a separate owner role. RLS policies on every tenant table; a CI test enumerates all tables with a `tenant_id` column and fails if any lacks a policy.
**Consequences.** Works with PgBouncer transaction pooling because the setting is transaction-local. Every DB access must be inside the tenant transaction (Prisma client extension/wrapper). Raw queries get the same treatment. Slight overhead per request.

## ADR-0003: Platform admin separated from tenant users
**Context.** Super admin must not be reachable through tenant-level permissions.
**Decision.** Separate login route and token audience (`aud=platform`), separate guard, separate DB role used only by platform-admin services, every call audited. Impersonation requires reason + time limit and is logged in the target tenant's audit log.
**Consequences.** Two auth surfaces to test. Prevents privilege escalation via role edits.

## ADR-0004: Transactional outbox for domain events
**Context.** Automations, notifications and analytics must not lose or duplicate events.
**Decision.** Domain events are inserted into `outbox_events` in the same transaction as the state change; a relay publishes to BullMQ; consumers are idempotent.
**Consequences.** At-least-once delivery, no dual-write bugs. Small latency (sub-second polling or LISTEN/NOTIFY).

## ADR-0005: Integration secrets use envelope encryption
**Context.** WhatsApp tokens, Razorpay keys etc. are stored per tenant.
**Decision.** Per-record data key encrypted by a master key (AWS KMS in prod, a local key from env in dev). Secrets never logged or returned; APIs return masked value + status.
**Consequences.** Key rotation supported by re-wrapping data keys. Adds a KMS dependency in prod.

## ADR-0006: SSE for real-time
**Context.** Server-to-client push only (new messages, notifications, status changes).
**Decision.** SSE per session with Redis pub/sub fan-out. Client sends via normal REST.
**Consequences.** Simpler through proxies/CDNs, auto-reconnect with `Last-Event-ID`. If bidirectional needs appear (typing indicators from the agent side, presence), revisit.

## ADR-0007: AI = single orchestrator + tool registry
**Context.** The brief lists "AI Assistant" and "AI Agents".
**Decision.** One orchestrator per conversation turn with a registry of ten validated tools. No autonomous multi-agent loops in MVP. "Agent" in the module list means the executable tool layer.
**Consequences.** Predictable cost and testability. Multi-agent workflows are [LATER].

## ADR-0008: Version policy (stable channels, with two deliberate deviations from npm `latest`)
**Context.** Registry check on 2026-11-16: TypeScript `latest` = 7.0.2, Prisma `latest` = 8.0.0-rc.33 (release candidate), NestJS `latest` = 12.5.0.
**Decision.**
- Prisma: **7.10.1** (last stable on the `prev` tag). Do not use release candidates in a product handling tenant data.
- TypeScript: **6.0.3**. TS 7 is a major rewrite; NestJS relies on decorator metadata and several toolchain pieces (ts-node/SWC/Vitest plugins, Prisma generators) whose TS 7 support I have not verified. Revisit after the Phase 1 spike.
- NestJS: **12.5.0** as registry `latest`; fallback 11.2.10 if ecosystem packages (swagger, throttler, bullmq integration) lag.
**Consequences.** A Phase 1 "compatibility spike" (scaffold, build, test, one RLS-wrapped Prisma query on the pinned set) is the first task. Results recorded here. Versions are exact-pinned in lockfiles and updated by Renovate.

## ADR-0009: Industry Packs
**Context.** Must be extensible beyond real estate.
**Decision.** Versioned config object (fields, stages, lost reasons, scoring defaults, prompts, qualifying questions, terminology, automation defaults). Loaded at onboarding and copied into tenant-editable tables; pack upgrades are opt-in migrations.
**Consequences.** Core code has no real-estate branching. Copy-on-onboard means tenant edits survive pack updates.

## ADR-0010: Lead vs. contact
**Context.** Conversations and consents attach to a person; leads may be created before a conversation.
**Decision (provisional).** MVP uses `leads` as the person record (one lead ↔ one phone identity per tenant); a separate `contacts` table is deferred. Revisit in Phase 3 if multi-lead-per-contact becomes necessary.
**Consequences.** Simpler schema. Migration cost later if we split.

---

## ADR-0011: API runs from a `tsc` build under plain Node (not tsx); explicit `@Inject()` everywhere
**Context.** Phase 1 finding (2026-11-16): the API passed all Vitest tests but failed to boot under `tsx` (`ThrottlerGuard` could not resolve `Reflector`). `tsx` transpiles `require()`d ESM packages into a second copy of `@nestjs/core` (Nest 12 is ESM, `@nestjs/throttler` 6.7 is CJS), so class identity differs. esbuild-based tools also do not emit `design:paramtypes` metadata.
**Decision.** Production and dev run `node dist/main.js` from a `tsc` build (`pnpm dev` = `tsc --watch` + `node --watch`). All constructor dependencies use explicit `@Inject(Token)`, so nothing depends on emitted metadata. CI runs `pnpm --filter @leadpilot/api smoke`, which boots the built server under plain Node.
**Consequences.** Slightly slower dev reload than tsx. Eliminates a class of "works in tests, breaks in prod" failures. Revisit if `@nestjs/throttler` ships ESM or when moving to SWC.

## ADR-0012: `packages/ui` deferred; UI components live in `apps/web` for now
**Context.** The brief lists `packages/ui`. Only one frontend exists, and shadcn components are copied source that is customised per app.
**Decision.** Design tokens and shadcn-style components live in `apps/web` (`components/ui`, `app/globals.css`). Extract to `packages/ui` if a second frontend (e.g. platform admin as a separate app, embeddable widget) needs them.
**Consequences.** Less build plumbing now. Extraction is mechanical later.
