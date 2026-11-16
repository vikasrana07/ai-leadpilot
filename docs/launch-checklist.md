# Production launch checklist

Honest go/no-go. `[x]` = done **and verified**; `[ ]` = not done or not verified. Owner and date are placeholders. Last audited against the code: Phase 7. Items marked (code) can be checked in the repo; most others need accounts, people or a deployed environment that do not exist yet.

## Security
- [ ] Phase 7 security review findings: no open high severity. Owner: {{OWNER}} (see `PROGRESS.md` Phase 7 section for the review result)
- [ ] All production secrets generated fresh and stored in a secret manager (`JWT_ACCESS_SECRET`, `PLATFORM_JWT_SECRET`, `LOCAL_MASTER_KEY`, DB passwords, provider keys)
- [ ] Master key: **KMS-backed key provider is not implemented** (`MasterKeyProvider` is synchronous; only `LocalKeyProvider` exists). Decide: accept an env-held key stored in Secrets Manager for launch, or build the KMS provider first. Owner: {{OWNER}}
- [ ] Production env passes startup validation (mock WhatsApp/AI/Razorpay/virus-scan all refused in production) (code)
- [ ] TLS everywhere; HSTS; `WEB_ORIGIN`/`PUBLIC_API_URL` set to real HTTPS origins; one proxy hop in front of the API (`trust proxy` = 1)
- [ ] ClamAV reachable from api (uploads fail closed otherwise)
- [ ] Platform admin(s) created; strong passphrases; console not exposed publicly if avoidable (IP allow-list at the ALB); MFA not available (accepted risk?)
- [ ] Dependency audit clean or accepted (`pnpm audit`)
- [ ] Penetration test or independent review: not done

## Data and database
- [ ] RDS Postgres 17 with pgvector; owner/app role split reproduced (`infrastructure/docker/postgres-init.sh` is the reference); app role NOSUPERUSER/NOBYPASSRLS
- [ ] Migrations applied by the owner role via the migrate task; RLS coverage guard test passes in CI
- [ ] Automated backups + PITR enabled; **restore drill executed and recorded** in `docs/runbooks/database-backup-restore.md`
- [ ] Master key backed up separately from database backups
- [ ] S3 bucket pre-created, private, versioned, default encryption on
- [ ] Data-principal rights: single-lead export and erasure **built** (`/privacy/leads/:id/...`, API only, tested); **not built:** tenant-wide export/deletion at contract end, retention policies/job, raw webhook payload purge, a UI ({{OWNER}} to define the manual process until then)

## Billing (Razorpay + GST)
- [ ] Razorpay live account activated (KYC, business verification); test-mode run of the full flow done first: **live client has never been exercised**
- [ ] Webhook registered at `<PUBLIC_API_URL>/webhooks/razorpay` with `RAZORPAY_WEBHOOK_SECRET`; events `subscription.*`, `payment.failed`
- [ ] Verified against real Razorpay: plan creation, subscription with `start_at`, upgrade proration, cancel at cycle end, webhook payload shapes
- [ ] `SELLER_*` env set; GSTIN valid; **SAC code and invoice format reviewed by a chartered accountant**
- [ ] Plan prices/limits reviewed against real unit economics (`docs/unit-economics.md` values are placeholders)
- [ ] `SIGNUP_PLAN` decision (trial plan) made

## WhatsApp / Meta
- [ ] Meta Business verification for the platform and/or guidance for tenants to verify theirs
- [ ] Message templates (`welcome_lead`, `appointment_confirmation`, `appointment_reminder`, `no_show_followup`) submitted and approved per tenant (tenant task; onboarding must explain)
- [ ] Live client verified against Meta (send, receive, statuses, media): **never run**
- [ ] Webhook URL + verify token handshake tested with a real number
- [ ] Tenants understand they pay Meta directly (onboarding copy)

## AI
- [ ] OpenAI account, key, spend limits; live eval (`EVAL_LIVE=1`) run and reviewed (Hindi/Hinglish quality, tool use, injection): **never run**
- [ ] Prompt-injection corpus passes against the real model
- [ ] AI disclosure text reviewed; kill switch procedure rehearsed

## Email
- [ ] Provider chosen (SES or Resend) and live; sending domain with SPF, DKIM, DMARC; bounce/complaint handling; `MAIL_FROM` set; verification/invite/billing mails tested end to end

## Operations
- [ ] api + worker + web deployed from the images in `infrastructure/docker`; worker running (nothing time-based works without it)
- [ ] `/health/ready` wired to the load balancer; uptime probe configured
- [ ] Alerts from `docs/slos-and-alerts.md` implemented (metrics/alerting layer **not built**)
- [ ] Log aggregation and retention; Sentry/OpenTelemetry (not built)
- [ ] Load test against budgets passed (dashboard < 2 s at 100k leads, webhook ACK < 1 s): result recorded in `PROGRESS.md`
- [ ] E2E suite green in CI; CI has run on a real GitHub remote (no remote yet)
- [ ] On-call rota, escalation, status channel `{{STATUS_PAGE_OR_CHANNEL}}`
- [ ] Runbooks read through once by someone who did not write them

## Legal and compliance
- [ ] Terms, Privacy Policy, DPA, AUP, sub-processor list in `docs/legal/` reviewed and adapted by an Indian lawyer; placeholders filled; published in the app and at signup
- [ ] Grievance Officer appointed and published
- [ ] DPDP position decided: roles per data type, consent notices, breach process agreed (`docs/runbooks/data-breach-dpdp.md`), cross-border transfer statement
- [ ] GST registration, invoicing and filing process
- [ ] WhatsApp Business policy compliance reviewed with tenants' opt-in flows

## Support
- [ ] Support email/channel, hours, response targets
- [ ] Console admins trained on `docs/runbooks/tenant-support.md` (no impersonation exists)
- [ ] Onboarding guide and setup docs final

## Go / no-go
Launch only when every Security, Data (backup+restore), Billing (live verified), Legal and Operations (worker, alerts, load test) item above is checked. WhatsApp, AI and email live verification are launch blockers for the features that depend on them.
