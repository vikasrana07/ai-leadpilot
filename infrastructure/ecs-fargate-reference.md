# ECS/Fargate reference notes (UNVERIFIED: nothing here has been deployed)

Shape (matches `docs/deployment.md`): three ECS services from two images.

| Service | Image | Command | Desired count | Port | Health |
|---|---|---|---|---|---|
| `leadpilot-api` | `leadpilot-api` | `node dist/main.js` | 2+ (behind ALB) | 4000 | ALB target group: `GET /health/ready`; container check: `GET /health` |
| `leadpilot-worker-outbox` | `leadpilot-api` | `node dist/worker-outbox.js` | 1-2 | none | ECS "essential container running"; alarm on outbox relay lag |
| `leadpilot-worker-ai` | `leadpilot-api` | `node dist/worker-ai.js` | 1-2 | none | ECS "essential container running"; alarm on `ai-knowledge-docs` queue depth |
| `leadpilot-web` | `leadpilot-web` | `node_modules/.bin/next start --port 3100` | 2+ (behind ALB) | 3100 | `GET /` |
| `leadpilot-migrate` (run-task, not a service) | `leadpilot-api` | see below | 1 per release | none | exit code |

Migration task: working dir `/app/node_modules/@leadpilot/database`, env `DATABASE_OWNER_URL` (owner role, from Secrets Manager), `DATABASE_URL`, and `DATABASE_SHADOW_URL` (set to the owner URL with a *different* database name, e.g. `.../unused_shadow`: `prisma.config.ts` rejects an empty value and one equal to the main DB, though `migrate deploy` never connects to it), command
`sh -c "node_modules/.bin/prisma migrate deploy && node dist/sync-permissions.js && node dist/sync-system-roles.js && node dist/backfill-packs.js"`.
Run it as an ECS `run-task` (or a CodeBuild/pipeline step) and gate the service update on exit code 0.

Task sizing starting points:
- `leadpilot-api`: 0.5 vCPU / 1 GB (Argon2id hashing uses 19 MiB per hash; keep API memory above ~512 MB).
- `leadpilot-worker-outbox`: 0.5 vCPU / 512 MB (lightweight, event-driven relay).
- `leadpilot-worker-ai`: 1-2 vCPU / 2-4 GB (PDF/DOCX extraction, chunking, and embedding generation).
- `leadpilot-web`: 0.5 vCPU / 1 GB.

Networking: tasks in private subnets; ALB in public subnets (TLS via ACM); RDS, ElastiCache and ClamAV only reachable from the task security group. Egress needed: Meta Graph API, OpenAI, Razorpay, SMTP provider, S3 (use a gateway VPC endpoint), Secrets Manager.

ClamAV: run `clamav/clamav:stable` as its own ECS service (needs ~3 GB RAM for signatures, a few minutes to become ready) with a Cloud Map/service-discovery name used as `CLAMAV_HOST`. The image is amd64-only.

Secrets: put each secret as a Secrets Manager entry and reference it in the task definition `secrets` block. Never bake values into images or task-definition `environment`.

Task role: S3 access scoped to the bucket. The S3 client only passes explicit credentials when both `S3_ACCESS_KEY` and `S3_SECRET_KEY` are set; otherwise it uses the AWS default credential chain, so a task role should work (by code reading, unverified). Leave `S3_ENDPOINT` unset for AWS S3. The code does not request server-side encryption itself: enable default bucket encryption (SSE-S3 or SSE-KMS) on the bucket, and pre-create the bucket (the API tries `CreateBucket` at boot if `HeadBucket` fails, which needs permissions you may not want to grant).

## Logging, health and monitoring (UNVERIFIED example settings)
Alarm and log-group definitions: `infrastructure/monitoring/cloudwatch-alarms.example.yml` (the log group names below match its defaults). Application behaviour: `docs/monitoring.md`.

**Logs.** Each container writes JSON lines to stdout; the awslogs driver ships them. Create the log groups through the template (so retention is set) and tell the driver not to create them:
```json
"logConfiguration": {
  "logDriver": "awslogs",
  "options": {
    "awslogs-group": "/leadpilot/api",
    "awslogs-region": "ap-south-1",
    "awslogs-stream-prefix": "api",
    "awslogs-create-group": "false"
  }
}
```
Use `/leadpilot/worker` with prefix `worker` for the worker and `/leadpilot/web` with prefix `web` for the web service. The task execution role needs `logs:CreateLogStream` and `logs:PutLogEvents` on these groups. Retention is the `LogRetentionDays` template parameter (default 30); it must match the {{LOG_RETENTION}} statement in `docs/legal/privacy-policy.md`.

**Metrics.** The same stdout stream carries CloudWatch Embedded Metric Format lines (`"_aws"` objects, every `METRICS_INTERVAL_SECONDS`); CloudWatch Logs turns them into custom metrics in the `LeadPilot` namespace with no agent or SDK. Nothing extra to deploy.

**Environment variables for monitoring.** Set them explicitly in production (the defaults are only safe guesses):
| Variable | Production value |
|---|---|
| `LOG_FORMAT` | `json` |
| `LOG_LEVEL` | `log` (use `warn` to cut log volume and cost) |
| `ACCESS_LOG` | `true` |
| `METRICS_EMF` | `true` |
| `METRICS_INTERVAL_SECONDS` | `60` |
| `ALERTS_ENABLED` | `true` |
| `ALERT_EMAIL_TO` | on-call address list (comma separated); empty means every active platform admin |
| `ALERT_REPEAT_HOURS` | `6` |

**Worker health.** The worker has no HTTP port, so there is no container health check for it. Its liveness is a heartbeat key in Redis (every 30 s, 90 s lifetime): the in-app alert `worker_not_running` and the `WorkersAlive` alarm watch it, and the platform console's **Ops status** page shows the live heartbeats. ECS only restarts a worker whose process exits (the crash handlers exit with code 1 on an uncaught error).

**Load balancer health checks.** API target group: `GET /health/ready` (database and Redis; returns 503 if the database is down). Web target group: `GET /`. Container-level check for the API image: `GET /health` (liveness only).

**External probe.** An app that is down cannot email. Add an outside probe of `/health/ready`: `docs/runbooks/external-uptime-probe.md`.

