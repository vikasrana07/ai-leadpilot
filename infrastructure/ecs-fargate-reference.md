# ECS/Fargate reference notes (UNVERIFIED: nothing here has been deployed)

Shape (matches `docs/deployment.md`): three ECS services from two images.

| Service | Image | Command | Desired count | Port | Health |
|---|---|---|---|---|---|
| `leadpilot-api` | `leadpilot-api` | `node dist/main.js` | 2+ (behind ALB) | 4000 | ALB target group: `GET /health/ready`; container check: `GET /health` |
| `leadpilot-worker` | `leadpilot-api` | `node dist/worker.js` | 1 (2 for redundancy) | none | ECS "essential container running"; alarm on queue/outbox lag (see `docs/slos-and-alerts.md`) |
| `leadpilot-web` | `leadpilot-web` | `node_modules/.bin/next start --port 3100` | 2+ (behind ALB) | 3100 | `GET /` |
| `leadpilot-migrate` (run-task, not a service) | `leadpilot-api` | see below | 1 per release | none | exit code |

Migration task: working dir `/app/node_modules/@leadpilot/database`, env `DATABASE_OWNER_URL` (owner role, from Secrets Manager), `DATABASE_URL`, and `DATABASE_SHADOW_URL` (set to the owner URL with a *different* database name, e.g. `.../unused_shadow`: `prisma.config.ts` rejects an empty value and one equal to the main DB, though `migrate deploy` never connects to it), command
`sh -c "node_modules/.bin/prisma migrate deploy && node dist/sync-permissions.js && node dist/sync-system-roles.js && node dist/backfill-packs.js"`.
Run it as an ECS `run-task` (or a CodeBuild/pipeline step) and gate the service update on exit code 0.

Task sizing starting points (guesses, not measured): api 0.5 vCPU / 1 GB, worker 0.5 vCPU / 1 GB, web 0.5 vCPU / 1 GB. Argon2id hashing uses 19 MiB per hash, so keep API memory above ~512 MB.

Networking: tasks in private subnets; ALB in public subnets (TLS via ACM); RDS, ElastiCache and ClamAV only reachable from the task security group. Egress needed: Meta Graph API, OpenAI, Razorpay, SMTP provider, S3 (use a gateway VPC endpoint), Secrets Manager.

ClamAV: run `clamav/clamav:stable` as its own ECS service (needs ~3 GB RAM for signatures, a few minutes to become ready) with a Cloud Map/service-discovery name used as `CLAMAV_HOST`. The image is amd64-only.

Secrets: put each secret as a Secrets Manager entry and reference it in the task definition `secrets` block. Never bake values into images or task-definition `environment`.

Task role: S3 access scoped to the bucket. The S3 client only passes explicit credentials when both `S3_ACCESS_KEY` and `S3_SECRET_KEY` are set; otherwise it uses the AWS default credential chain, so a task role should work (by code reading, unverified). Leave `S3_ENDPOINT` unset for AWS S3. The code does not request server-side encryption itself: enable default bucket encryption (SSE-S3 or SSE-KMS) on the bucket, and pre-create the bucket (the API tries `CreateBucket` at boot if `HeadBucket` fails, which needs permissions you may not want to grant).
