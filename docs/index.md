# AI LeadPilot — Documentation Index

*Last analyzed: 2026-11-27*

Welcome to the central AI-ready knowledge base for **AI LeadPilot**. Read this index first to navigate the project's architecture, business rules, APIs, database schema, workflows, and screen inventory without scanning the entire codebase.

---

## Core Documentation

| Section | Document | What It Covers |
|---|---|---|
| **Overview** | [docs/overview/README.md](overview/README.md) | Product purpose, target personas, Industry Packs, and monorepo layout |
| **Architecture** | [docs/architecture/README.md](architecture/README.md) | System diagram, Next.js App Router, NestJS 12 guard pipeline, RLS, SSE, SecretBox, BullMQ workers |
| **Database** | [docs/database/README.md](database/README.md) | All 46 Prisma models, ERD, enums, RLS (`withTenant`), soft deletes, `pgvector` |
| **API Reference** | [docs/api/README.md](api/README.md) | OpenAPI summary (286 paths, 357 ops, 59 tags), auth mechanisms, and endpoint groups |
| **Workflows** | [docs/workflows/README.md](workflows/README.md) | End-to-end flows: Auth/MFA, Lead Capture, AI Shadow-to-Live, Slot Rescue, Automations, Broadcasts, Billing |
| **Business Rules** | [docs/business-rules/README.md](business-rules/README.md) | Verified rules (RLS, RBAC, pipeline, scoring, 24h WhatsApp window, healthcare safety, GST/read-only) vs inferred assumptions |
| **Development** | [docs/development/README.md](development/README.md) | Local Docker stack, env validation, commands, OpenAPI/Orval codegen, Vitest & Playwright E2E |
| **Screen Inventory** | [docs/screens/inventory.md](screens/inventory.md) | Central index of all 55 discovered routes with per-screen docs in `docs/screens/pages/` |
| **Screen Flows** | [docs/screens/README.md](screens/README.md) | Grouped screen guides (`01`–`05`) and end-to-end Mermaid navigation flowcharts |

---

## Developer & Operations Reference (Existing Docs)

- **Agent Knowledgebase**: [docs/knowledgebase/README.md](knowledgebase/README.md) (`01-monorepo-and-packages.md`, `02-backend-and-worker-guide.md`, `03-frontend-and-testing-guide.md`)
- **ADRs**: `docs/decisions/`
- **Operations & Runbooks**: `docs/runbooks/`, [docs/deployment.md](deployment.md), [docs/monitoring.md](monitoring.md), [docs/slos-and-alerts.md](slos-and-alerts.md)
- **Security & Compliance**: [docs/threat-model.md](threat-model.md), [docs/security-review.md](security-review.md), [docs/roles-and-access.md](roles-and-access.md)
