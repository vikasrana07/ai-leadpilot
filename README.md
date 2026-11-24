# LeadPilot

Multi-tenant WhatsApp CRM: lead capture, inbox, AI assistant, pipeline, appointments, campaigns and reports.
Monorepo (pnpm + Turborepo): `apps/api` (NestJS), `apps/web` (Next.js), `packages/*` (Prisma/Postgres with row-level security, shared types and validation).

- **Setup, environment variables and live provider guides:** [docs/setup-guide.md](docs/setup-guide.md)
- **Architecture and decisions:** [docs/architecture.md](docs/architecture.md), [docs/decisions](docs/decisions)
- **Operations:** [docs/runbooks](docs/runbooks/README.md)
- **Security policy:** [SECURITY.md](SECURITY.md)

## Local development

```bash
cp .env.example .env        # then fill in the secrets the file asks for
pnpm install
pnpm infra:up               # Postgres, Redis, MinIO, Mailpit, ClamAV
pnpm db:migrate
pnpm dev                    # API on :4000, web on :3100
```

Run the background worker (outbox relay, automations, scheduler) in a second terminal with `pnpm --filter @leadpilot/api worker`, or set `WORKERS_ENABLED=true` for a single process.

## Create a platform admin (super-admin)

The platform console (suspend tenants, change plans, support access, MRR) is for the operator of the whole system, not for a workspace owner.
There is no default admin, and admins cannot be created from the app. Create one from the **repository root** with the schema-owner database role:

```bash
PLATFORM_ADMIN_PASSWORD='<12+ chars>' pnpm --filter @leadpilot/database platform:create-admin you@x.com "Your Name"
```

Then sign in at **http://localhost:3100/platform/login**.

Things that make it fail or surprise people:

- **The password comes from the environment, never from the command line.** Set `PLATFORM_ADMIN_PASSWORD` on the same command, with at least 12 characters. If it is missing or short the command exits with status 1.
- **`.env` must contain `DATABASE_OWNER_URL`** (the owner role, not `DATABASE_URL`), and the database must be running (`pnpm infra:up`).
- **`PLATFORM_JWT_SECRET`** (32+ characters, `openssl rand -base64 48`) must be set in `.env`, otherwise the console is disabled.
- **Running it again for an existing email resets that admin's password** and clears a lockout; it does not change MFA.
- **MFA:** off by default in development, required in production (`PLATFORM_REQUIRE_MFA`). Enrol an authenticator app at `/platform/security`.
- **Lockout:** five failed sign-ins lock the account for 15 minutes. Platform sessions last 30 minutes.
- **Use a separate browser profile** from your tenant login: the platform cookie is separate.

More detail: [docs/runbooks/tenant-support.md](docs/runbooks/tenant-support.md) and the "Billing and the platform console" section of [docs/setup-guide.md](docs/setup-guide.md).
