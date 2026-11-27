# AI LeadPilot — Project Overview

*Last analyzed: 2026-11-27*

## What Is AI LeadPilot?

**AI LeadPilot** is a multi-tenant SaaS CRM, omnichannel messaging, AI qualification, and workflow automation platform built for high-touch service and sales businesses (primarily tailored for Indian SMBs with INR pricing, GST invoicing, and WhatsApp-first customer communication).

The platform captures leads from WhatsApp, Website Chat, Meta Lead Ads, Facebook Messenger, Instagram DMs, Property Portals (via email parsing), Google Sheets, CSV imports, and a public REST API; qualifies them using a RAG-powered AI assistant and rule-based scoring; books appointments without double-booking; automates follow-ups; and provides analytics including a Revenue Leakage Radar.

---

## Target Users & Personas

| Persona | Role / Access | Primary Responsibilities |
|---|---|---|
| **Business Owner** | `owner` system role (all 41 permissions) | Workspace setup, billing & GST profile, team & custom roles, MFA policy, SSO, data retention/deletion, full CRM & analytics |
| **Sales Manager** | `manager` system role (team-wide CRM, AI/automation management) | Lead assignment, pipeline stage config, broadcast campaigns, automations, team analytics, email suppressions |
| **Sales Agent** | `agent` system role (`:own`-scoped reads/writes) | Managing assigned leads, replying in Inbox, booking appointments, completing follow-up tasks |
| **Custom Role Members** | Custom `Role` + optional `MemberPermissionOverride` (`GRANT`/`REVOKE`) | Granular combinations of `PermissionKey`s |
| **End-Customer (Lead)** | Public Portal (`/p/[key]`, `/p/claim/[token]`) & Web Widget | Chatting via website widget, confirming/rescheduling/cancelling appointments via OTP portal, claiming rescued slots, submitting DPDP data requests |
| **Platform Staff** | `PlatformAdmin` (`/platform/*`, isolated auth) | Vendor operations, tenant suspension/reactivation, plan management, support access sessions, system health & alerts |

---

## Industry Packs (Dynamic Terminology & Modules)

Core code never branches on industry. Instead, `packages/shared-types/src/industry-packs.ts` defines 5 versioned **Industry Packs** that seed initial pipeline stages, lost reasons, lead sources, and custom fields at onboarding, and dynamically adapt UI terminology (`useTerms()`, `usePack()`) and AI prompt guidance:

| Pack ID | Label | Lead Noun | Appointment Noun | `properties` Module |
|---|---|---|---|---|
| `real_estate` | Real estate | Lead / Leads | Site visit | Enabled |
| `coaching` | Coaching & education | Enquiry / Enquiries | Demo class | Disabled |
| `healthcare` | Healthcare clinic | Enquiry / Enquiries | Consultation | Disabled (strict non-clinical AI safety rules) |
| `home_services` | Home services | Customer / Customers | Inspection | Disabled |
| `general` | General | Lead / Leads | Meeting | Disabled |

---

## Monorepo Structure

Managed with **pnpm** (`package.json`) and **Turborepo** (`turbo.json`), requiring Node `>=22`:

| Workspace | Package Name | Technology | Purpose |
|---|---|---|---|
| `apps/web` | `@leadpilot/web` | Next.js 16 (App Router, port 3100), React 19, Tailwind CSS v4, React Query v5, Zustand | Tenant workspace UI, auth pages, customer portal, and vendor platform console |
| `apps/api` | `@leadpilot/api` | NestJS 12 (ESM), Express, Swagger/OpenAPI, BullMQ, ioredis | REST API (port 4000), SSE realtime stream, webhooks, and worker entrypoints |
| `apps/worker` | `@leadpilot/worker` | Delegates to `apps/api/src/worker*.ts` | Background workers (`worker`, `worker:outbox`, `worker:ai`) |
| `packages/database` | `@leadpilot/database` | Prisma (`prisma-client`), PostgreSQL 17 + `pgvector`, Vitest | Schema, migrations, `withTenant()` RLS helper, soft-delete extension, seeders |
| `packages/validation` | `@leadpilot/validation` | Zod | Shared validation schemas for API `ZodPipe` and Web `react-hook-form` |
| `packages/shared-types` | `@leadpilot/shared-types` | TypeScript | Canonical `PermissionKey`s, `IndustryPack` definitions, `openapi.json` |
| `e2e/` | — | Playwright + `@axe-core/playwright` | 20 E2E, accessibility, keyboard, and mobile responsive test suites |
| `infrastructure/` | — | Docker Compose, monitoring, ECS reference | Local Postgres/Redis/Mailpit/MinIO/ClamAV stack and cloud reference |
