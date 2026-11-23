# 11 — Product Gap Analysis

Benchmark: what Indian SME buyers and mature SaaS in this category (WhatsApp-first CRM / lead-management such as the ones used by real-estate and education sales teams) typically expect. The comparison is my domain judgement, not a feature-by-feature competitor audit; no competitor products were inspected, and statements such as "ahead of typical SMB tools" or "largest competitive gap" in §E are opinions, not measured benchmarks. Priorities for E5-E8 depend on who the first customers are; confirm with sales before committing the effort. Evidence of absence = targeted search of `apps/` and `packages/` (keywords noted).

Priority: **P0** blocks launch/compliance · **P1** needed to win/retain first customers · **P2** competitive · **P3** enterprise/optional. Complexity: S ≤ 3 d, M 4–10 d, L 11–25 d, XL > 25 d (engineering days, one engineer).

## A. Essential capabilities (missing or incomplete)

| # | Gap | Business impact | User impact | Priority | Cx | Recommendation |
|---|---|---|---|:--:|:--:|---|
| E1 | **Live provider verification + deployed prod environment** (WhatsApp, OpenAI, Razorpay, SMTP/SES, KMS, Turnstile) | Cannot take money or send messages reliably; every integration assumption unproven | Failed onboarding, missed messages, payment errors | P0 | M | Execute `docs/live-verification.md`; deploy staging on the ECS reference; add synthetic checks |
| E2 | **Consent ledger and opt-in capture** (source, timestamp, proof, purpose; double opt-in; preference centre) | WhatsApp number bans, DPDP penalties, tenant churn | Leads receive unwanted marketing | P0 | M | Doc 07 §5; gate campaigns on it; add import attestation and widget/portal consent capture |
| E3 | **Campaign engine v1.1**: idempotent leased sender, scheduled-sweep fix, quotas/entitlements, Meta-tier throttling, retry-failed, test-send, template approval status, cost estimate, reply/conversion attribution | Campaigns are the likely revenue differentiator and also the biggest risk | Duplicate sends, silent non-launch, no ROI view | P0 | L | See roadmap R1–R3 |
| E4 | **Email deliverability basics**: unsubscribe link + `List-Unsubscribe` one-click, SPF/DKIM/DMARC health check, SES API sending with correct id mapping, bounce/complaint verification, per-agent scoping | Spam-folder placement, SES suspension | Missed emails, agents see colleagues' mail | P1 | M | SES SDK sender + configuration set; unsubscribe route; permissions `email:*` |
| E5 | **Lead-source integrations** for real estate and education: Meta Lead Ads, Google Ads lead forms, property portals (99acres, MagicBricks, Housing), Zapier/Make connector | Leads must arrive automatically; manual import is not a product | Reps copy-paste leads | P1 | L | Start with Meta Lead Ads (same Meta app) and a Zapier/Make connector on top of `/v1`; evidence of absence: no code references to 99acres, MagicBricks, Housing.com, Exotel, Knowlarity or any Lead Ads ingestion endpoint (keyword search of `apps/` and `packages/`; incidental text matches ignored); the only automation hook is the generic `/v1` and `/api-keys/leads` intake |
| E6 | **Click-to-call / telephony logging** (Exotel, Knowlarity, Ozonetel) | Indian sales is call-centric; calls missing from the 360° timeline | Reps use a second tool | P1 | M | Webhook + call-log activity type; later click-to-call |
| E7 | **Mobile experience**: PWA with push notifications for new inbound/SLA breach | Reps live on phones; late replies lose leads | Responsive web only; no installable app/push (no manifest file, service worker or `public/` assets found in `apps/web`) | P1 | M | PWA + Web Push first, native later if justified |
| E8 | **Voice-note handling** (WhatsApp audio is common in India): transcription → AI/summary | AI misses a large share of inbound content | Agents must play audio | P2 | M | Transcribe via provider; store transcript on message |
| E9 | **Lead assignment depth**: assignment strategy is only `manual` or `round_robin` (`assignmentSettingsSchema`, `packages/validation/src/crm.ts:142`); no skill/territory/working-hours routing and no reassign-on-SLA-breach found | Manual triage burden | Uneven workloads | P2 | M | Extend assignment rules; use SLA events |
| E10 | **Metering and billing of messaging/email volume** | Unbounded cost to vendor or tenant | Surprise bills or throttling | P1 | M | `usage_counters`; plan entitlements for campaigns/email; show in `/usage` |
| E11 | **Backup/restore evidence and DR plan** | Data loss risk, enterprise blockers | – | P1 | S | Run `scripts/backup-restore-drill.sh`, record RPO/RTO, test PITR |
| E12 | **Working CI/CD** (green lint, deploy pipeline, migrations gate, rollback) | Cannot ship safely | – | P0 | M | Doc 13 R0 |

## B. Incomplete workflows in existing modules

| # | Gap | Impact | Priority | Cx | Recommendation |
|---|---|---|:--:|:--:|---|
| W1 | Google Calendar is one-way push + free/busy; no two-way sync, no failure surfacing, OAuth state missing | Double bookings with personal calendars, silent drift | P1 | M | State/PKCE, outbox-driven sync, status/last-error on the card, optional watch channels |
| W2 | Email tracking has no templates, sequences, inbound reply capture or per-lead composer history beyond list | Limited stickiness vs email add-ons | P2 | L | Templates + reply sync via SES inbound or IMAP later |
| W3 | Campaign recipients cannot be retried/resent, no A/B, no quiet hours | Operational friction | P2 | M | Retry failed with new idempotency key; quiet-hours window |
| W4 | CSV import is synchronous, capped at 5,000 rows (`lead-import.service.ts:15`); export capped at 50,000 | Tenants migrating from other CRMs must split files; large exports are silently truncated | P2 | M | Raise caps with a queued import, row-level error report download, streamed export and a truncation warning |
| W5 | Reports are fixed keys; no scheduled email reports or funnel/cohort/attribution by source/ad | Owners cannot see ROI | P2 | M | Saved/scheduled reports, source→revenue attribution |
| W6 | Audit log lacks export and tamper evidence | Enterprise/compliance asks | P2 | S | CSV/JSON export, hash chain, WORM sink |
| W7 | Roles UI exists; no approval workflows, no field-level permissions, no per-pipeline access | Medium-size teams need it | P3 | L | Defer until demanded |
| W8 | i18n is an English-only scaffold (`lib/i18n.ts`) | Hindi/regional UI is a differentiator in Tier-2/3 cities | P2 | M | Finish migration to `t()`, add `hi` catalogue |
| W9 | Inbox lacks bulk actions and @mentions (no matches in `app/(app)/inbox` or `components/inbox`); saved views exist for data tables (`data-table/quick-views.tsx`) but I did not check the inbox | Team productivity | P2 | M | Add incrementally from usage data |

## C. Enterprise capabilities (absent)

| # | Gap | Priority | Cx | Notes |
|---|---|:--:|:--:|---|
| N1 | SSO (SAML/OIDC) and SCIM provisioning | P3 | L | No matches in code |
| N2 | IP allow-listing, session policies, device management | P3 | M | |
| N3 | Data residency / region pinning, customer-managed keys | P3 | L | KMS exists per environment, not per tenant |
| N4 | Custom domain & white-label (widget, portal, email tracking domain) | P3 | M | Tracking links use one `TRACKING_BASE_URL` |
| N5 | Public status page, SLA, 24×7 support process | P3 | S–M | Runbooks exist; no external page |
| N6 | SOC 2 / ISO 27001 readiness | P3 | XL | Prereq: CI/CD controls, access reviews, vendor management |
| N7 | Sandbox tenants, API versioning policy, webhook replay tooling in UI | P3 | M | Redeliver exists |

## D. Optional enhancements
Property-matching AI recommendations, e-signature/documents, loyalty/referral flows, in-app payments collection for tenants, Outlook calendar, marketplace/app directory, advanced AI (outbound qualification calls), BI export (warehouse sync).

## E. Competitive maturity summary

| Capability family | Maturity vs. a mature SaaS in this niche |
|---|---|
| Core CRM, pipeline, tasks | At par for SMB |
| WhatsApp inbox + AI qualification | Strong on paper; unproven live |
| Automation builder | Ahead of typical SMB tools (graph + dry-run + versions) |
| Appointments | At par; calendar sync behind |
| Outbound campaigns & email | Early; compliance and reliability gaps |
| Lead-source integrations & telephony | **Behind** (largest competitive gap for real-estate buyers) |
| Mobile | Behind |
| Reporting/attribution | Basic |
| Billing/GST | Ahead of typical (GST invoices, grace/dunning) |
| Security/tenancy | Ahead for the stage |
| Enterprise (SSO, residency, audit export) | Absent |
