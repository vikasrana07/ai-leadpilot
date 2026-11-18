# Production deployment guide

Reference target: AWS (ECS/Fargate + RDS + ElastiCache + S3). **Status legend:** *verified* = done during Phase 7 on a developer machine; *unverified* = reasoned from the code/AWS docs and never executed. Nothing in this guide has been deployed to AWS.

## 1. Artifacts
| Image | Dockerfile | Runs | Status |
|---|---|---|---|
| `leadpilot-api` | `infrastructure/docker/Dockerfile.api` | API (`node dist/main.js`), worker (`node dist/worker.js`), migrations and admin scripts | **Built (937 MB on disk); booted with `NODE_ENV=production` (dummy live-mode provider values, so startup validation passed) against the dev Postgres/Redis/MinIO; `/health/ready` returned `ready`, unauthenticated `/tenant` returned 401, container healthcheck healthy, non-root `node`; `node dist/worker.js` started ("Worker running"); the migrate command ran successfully as a no-op** |
| `leadpilot-web` | `infrastructure/docker/Dockerfile.web` | Next.js (`next start`) | **Built (1.43 GB on disk); booted standalone: `/login` returned 200, container healthcheck healthy, runs as non-root `node`. Not tested against a real API from a browser.** |

Build from the repo root:
```
docker build -f infrastructure/docker/Dockerfile.api -t leadpilot-api:<tag> .
docker build -f infrastructure/docker/Dockerfile.web --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t leadpilot-web:<tag> .
```
`NEXT_PUBLIC_API_URL` is compiled into the browser bundle: build a web image per environment. No secrets are baked into either image; everything is runtime environment.
The images use `pnpm deploy --legacy --prod` to produce a self-contained tree. The web image runs `next start` (no standalone output). Optional size reduction: set `output: 'standalone'` in `apps/web/next.config.ts` (and `outputFileTracingRoot` to the repo root for the monorepo) and copy `.next/standalone`; this was **not** done or tested.
Example compose: `infrastructure/docker/docker-compose.prod.example.yml`. ECS notes: `infrastructure/ecs-fargate-reference.md` (including logging and monitoring settings). Monitoring: `docs/monitoring.md`, example alarms in `infrastructure/monitoring/cloudwatch-alarms.example.yml`, and the required external probe `docs/runbooks/external-uptime-probe.md`.

## 2. Topology (unverified)
- **ALB** (TLS via ACM) with two target groups: `api` (health check path `/health/ready`) and `web` (`/`). Host-based rules: `app.<domain>` to web, `api.<domain>` to api. Exactly **one proxy hop** in front of the API (the API sets `trust proxy` to 1; more hops or none breaks client IP detection and rate limits).
- **ECS services:** api (2+ tasks), web (2+), worker (1-2). All in private subnets.
- **RDS PostgreSQL 17** with the `vector`, `citext`, `btree_gist`, `pgcrypto`, `pg_trgm` extensions (`pgvector` is supported on RDS). Multi-AZ, automated backups + PITR, storage encryption (KMS).
- **ElastiCache Redis 7** (BullMQ + rate-limit counters). Use TLS (`rediss://`) if in-transit encryption is enabled.
- **S3** bucket (private, versioned, default encryption, public access blocked).
- **ClamAV**: `clamav/clamav:stable` as its own service (amd64 only, ~3 GB RAM, minutes to load signatures); `CLAMAV_HOST`/`CLAMAV_PORT`. Uploads fail closed if it is unreachable.
- **Outbound**: Meta Graph API, OpenAI, Razorpay, SMTP provider. Inbound public: ALB only (webhooks for Meta and Razorpay hit the API).

## 3. Database setup
Two roles, as in `infrastructure/docker/postgres-init.sh`:
- `leadpilot_owner`: owns the schema, runs migrations. Used only by the migrate task and admin scripts.
- `leadpilot_app`: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`; the **only** credential api/worker get (`DATABASE_URL`). If this role is superuser/owner, tenant isolation (RLS) silently stops working. On RDS, create both roles manually (the RDS master user is not a true superuser; the init script cannot be reused verbatim), then create extensions as the master user, make `leadpilot_owner` own the `public` schema, and verify with `docs/runbooks/database-backup-restore.md` verification queries.
Connection counts: each api/worker task opens a Prisma `pg` pool; size RDS `max_connections` for `(api + worker tasks) x pool size` (pool size is the `pg` default, 10: unverified under load).

## 4. Environment
Required in production (the API refuses to start otherwise: `loadEnv` validation):
| Variable | Notes |
|---|---|
| `NODE_ENV=production` | image default |
| `DATABASE_URL` | app role. `?sslmode=require` for RDS |
| `REDIS_URL` | |
| `WEB_ORIGIN` | the exact web origin (CORS + CSRF allow-list), e.g. `https://app.example.com` |
| `PUBLIC_API_URL` | public API base used in webhook URLs and the widget snippet |
| `JWT_ACCESS_SECRET` | >= 32 chars; rotating it signs everyone out |
| `LOCAL_MASTER_KEY` | base64 of 32 bytes; see KMS note |
| `PLATFORM_JWT_SECRET` | >= 32 chars; unset disables the platform console |
| `WHATSAPP_MODE=live` | mock refused in production |
| `AI_PROVIDER=openai`, `OPENAI_API_KEY` | mock refused in production; model names `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL` |
| `VIRUS_SCAN_MODE=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` | mock refused in production |
| `RAZORPAY_MODE=live`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | mock refused in production |
| `SELLER_GSTIN` (required in production), `SELLER_LEGAL_NAME`, `SELLER_STATE_CODE`, `SELLER_ADDRESS`, `INVOICE_SAC` | printed on GST invoices |
| `S3_BUCKET`, `S3_REGION`; `S3_ENDPOINT` unset for AWS; `S3_FORCE_PATH_STYLE=false` | credentials: `S3_ACCESS_KEY`/`S3_SECRET_KEY` are optional; without them the AWS default chain is used (task role), unverified |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP interface only; provider (SES/Resend) not chosen. Note the mailer sends without credentials (no `SMTP_USER/PASS` support in code): use a relay that accepts the task's network, or add auth support before using SES SMTP |
| `SIGNUP_PLAN` (e.g. `growth`), `BILLING_GRACE_DAYS` | trial/billing behaviour |
| `WORKERS_ENABLED` | `false` on api tasks; the worker command forces `true` |
| `QUEUE_PREFIX`, `AUTOMATION_MAX_ATTEMPTS`, `AUTOMATION_RETRY_BASE_MS` | defaults are fine |
| `AI_KILL_SWITCH`, `AI_DEFAULT_MONTHLY_TOKEN_CAP` | operational switches |
| `LOG_FORMAT=json`, `LOG_LEVEL`, `ACCESS_LOG`, `METRICS_EMF=true`, `METRICS_INTERVAL_SECONDS`, `ALERTS_ENABLED=true`, `ALERT_EMAIL_TO`, `ALERT_REPEAT_HOURS` | logging, metrics and alerting (optional with defaults, but set them explicitly in production): `docs/monitoring.md` |
| `THROTTLE_AUTH_LIMIT`, `THROTTLE_GLOBAL_LIMIT` | rate limits per minute per client |
Web image: only `NEXT_PUBLIC_API_URL` (build arg). Reference list: `.env.example`.

### Master key and KMS (be aware)
Provider tokens (WhatsApp) are envelope-encrypted: AES-256-GCM per-record data keys wrapped by a master key. The master key comes from `LOCAL_MASTER_KEY` through `LocalKeyProvider` (`keyId: local-1`). ADR-0005 says production should use KMS, but **no KMS-backed provider exists**, and the `MasterKeyProvider` interface is synchronous (`wrap`/`unwrap` return `Buffer`), so a KMS provider (async API) needs an interface change plus a re-wrap migration of existing records. Until then: keep `LOCAL_MASTER_KEY` in Secrets Manager (never in the task definition's plain environment), back it up separately from database backups (losing it makes stored WhatsApp tokens unreadable), and treat it like a root credential. Rotating it is not supported without re-wrapping.

## 5. Secrets
Secrets Manager (or SSM SecureString) entries injected through the ECS task definition `secrets` block: `DATABASE_URL`, `DATABASE_OWNER_URL` (migrate task only), `REDIS_URL` if it carries auth, `JWT_ACCESS_SECRET`, `LOCAL_MASTER_KEY`, `PLATFORM_JWT_SECRET`, `OPENAI_API_KEY`, `RAZORPAY_*`. Generate with `openssl rand -base64 48` (JWT/platform) and `openssl rand -base64 32` (master key). Never reuse dev values.

## 6. Domains, TLS, CORS, webhooks
- DNS: `app.<domain>` and `api.<domain>`. If the console cookie (`lp_platform`) must work across them, both must be the same registrable domain (it is SameSite=Strict). Tenant cookies are SameSite=Lax with `secure` in production.
- CORS allows only `WEB_ORIGIN` (credentials) except the public widget endpoints (any origin, token-based).
- Meta webhook per tenant channel: `<PUBLIC_API_URL>/webhooks/whatsapp/<key>` (shown in Integrations, with the verify token). Razorpay: `<PUBLIC_API_URL>/webhooks/razorpay` with `RAZORPAY_WEBHOOK_SECRET`, events `subscription.*`, `payment.failed`.
- The ALB/WAF must pass request bodies unmodified (signatures are over raw bytes).
- The Next.js app has no custom CSP yet; consider adding one at the CDN/ALB or in `next.config.ts`.

## 7. Releases, migrations, rollback
Order for every release:
1. Build and push images (immutable tags, e.g. git SHA).
2. **Snapshot RDS** (manual) if the release has migrations.
3. Run the **migrate task** (owner role) from the new image. *Verified command* (against the dev database, a no-op because it was up to date):
   `cd /app/node_modules/@leadpilot/database && node_modules/.bin/prisma migrate deploy && node dist/sync-permissions.js && node dist/sync-system-roles.js && node dist/backfill-packs.js`
   with `DATABASE_OWNER_URL`, `DATABASE_URL` and `DATABASE_SHADOW_URL` set. **Gotcha found:** `prisma.config.ts` rejects an empty `DATABASE_SHADOW_URL` and one equal to the main database even for `migrate deploy` (which never uses it): set it to the owner URL with a different database name (`.../unused_shadow`). Suggested fix in `packages/database/prisma.config.ts`: use `process.env.DATABASE_SHADOW_URL || undefined`.
4. Roll the worker, then the api, then the web (rolling deployments, health-gated).
5. Smoke: `/health/ready`, sign-in, webhook handshake for a test channel.
Migrations follow expand/contract: a release's migrations must be compatible with the **previous** image so rollback is "redeploy the previous image tag". Destructive changes (drop/rename) ship one release after the code stops using them. Rolling back the database itself means PITR restore ([runbook](runbooks/database-backup-restore.md)); avoid it.
Worker deploys: shutdown hooks drain gracefully; interrupted runs are recovered by the sweeper.

## 8. Scaling
- **API:** stateless; scale on CPU/latency. Rate-limit counters are shared via Redis, SSE realtime is per instance (a client's stream is on the task it connected to; events are published in-process: **multi-instance realtime fan-out is unverified**, check `RealtimeModule` before running more than one API task and relying on live updates).
- **AI turns run in the API process**, not the worker.
- **Workers:** safe to run N: outbox claimed with `FOR UPDATE SKIP LOCKED` (2-minute lease), BullMQ delivers each run to one worker, run claim is compare-and-set, scanners are exactly-once via `event_marks`. Start with 1 (2 for redundancy); more only if outbox lag/queue depth demands it. The maintenance tick runs in every worker; duplicated scans are harmless but wasteful.
- **Postgres:** vertical first; read replicas are not used by the code.

## 9. Cost notes (rough, unmeasured)
Fixed monthly floor is dominated by RDS Multi-AZ, ElastiCache, 3 Fargate service groups, ClamAV memory, ALB and NAT. Variable: OpenAI tokens (see `docs/unit-economics.md`; prices unverified), S3, data transfer. WhatsApp conversation fees are paid by tenants to Meta, not by us. Get real numbers from the AWS Pricing Calculator for your region before pricing plans.

## 10. Not verified
Everything AWS-side (including the monitoring template, log shipping, EMF metrics in CloudWatch and the alarms); the compose example as a whole; the web image talking to a real API from a browser; TLS/ALB behaviour and `trust proxy` in a real deployment; S3 via task role; multi-instance realtime; sizing/pool numbers; real Meta/OpenAI/Razorpay connectivity; SMTP authentication (see env table).
