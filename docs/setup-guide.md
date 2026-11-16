# Local setup

Prerequisites: Node 22, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
# put real random values in .env:
#   JWT_ACCESS_SECRET=$(openssl rand -base64 48)   LOCAL_MASTER_KEY=$(openssl rand -base64 32)
pnpm infra:up          # Postgres(pgvector) :5433, Redis :6380, Mailpit UI :8026 (non-default ports on purpose)
pnpm db:generate && pnpm build
pnpm db:migrate        # prisma migrate deploy (as owner role) + syncs the permission catalogue
pnpm db:seed           # optional, DEV ONLY: two demo workspaces (password printed by the script)
pnpm dev               # api :4000 (tsc --watch + node --watch), web :3100
```

Web: http://localhost:3100 · API docs/health: http://localhost:4000/health · Mail inbox (verification, invites, resets): http://localhost:8026
Design review screens (sample data, not connected): http://localhost:3100/design/inbox, `/design/lead`, `/design/pipeline`.

## Checks
```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @leadpilot/api build && pnpm --filter @leadpilot/api smoke   # boots the built API under plain Node
```
Tests need the infra running (they use the real Postgres through the **non-owner** `leadpilot_app` role, so RLS is exercised).

## Database roles
| Role | Used by | Notes |
|---|---|---|
| `leadpilot_owner` | migrations, permission sync, test cleanup | owns the schema; never used by the running API |
| `leadpilot_app` | API / worker (`DATABASE_URL`) | not superuser, not owner, no BYPASSRLS: every tenant policy applies |

## Environment variables
| Var | Purpose |
|---|---|
| `DATABASE_OWNER_URL` / `DATABASE_URL` | owner (migrations) / runtime (RLS-subject) connection strings |
| `POSTGRES_PASSWORD`, `APP_ROLE_PASSWORD`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT` | docker compose |
| `REDIS_URL` | reserved for Phase 5 (BullMQ, rate-limit store) |
| `API_PORT`, `WEB_ORIGIN` | API port; the single allowed browser origin (CORS + CSRF origin check) |
| `JWT_ACCESS_SECRET` | ≥32 chars, signs 15-min access tokens |
| `LOCAL_MASTER_KEY` | dev envelope-encryption key (used from Phase 3; prod uses KMS) |
| `SMTP_HOST/PORT`, `MAIL_FROM` | mail (Mailpit locally) |
| `NEXT_PUBLIC_API_URL` | API URL baked into the web build |
| `THROTTLE_AUTH_LIMIT`, `THROTTLE_GLOBAL_LIMIT`, `ENABLE_SWAGGER` | optional tuning |

The API refuses to start on missing/invalid variables (zod validation in `apps/api/src/config/env.ts`). `.env` is git-ignored.
