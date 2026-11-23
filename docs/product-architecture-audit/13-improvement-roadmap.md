# 13 — Prioritised Improvement Roadmap

**Estimation assumptions:** one senior full-stack engineer-day (productive, includes tests and review); ±30 % accuracy; excludes third-party lead times (Meta business verification and template approval, SES production access, Razorpay KYC); assumes the existing team knows the codebase; a team of 2–3 engineers can run Phase 1 in ~4 calendar weeks. Priorities: P0 must precede any customer; P1 before scale-up; P2 competitive; P3 on demand. IDs referenced in docs 08 (S-xx), 11 (E/W/N) and 14 (TD-xx).

## Summary

| Phase | Theme | Initiatives | Effort (eng-days) |
|---|---|---|---:|
| 1 | Critical: correctness, compliance, security, production proof | R0–R11 | ~50 |
| 2 | Architecture: integrity, boundaries, reliability | A1–A11 | ~49 |
| 3 | Product completeness | P1–P9 | ~65 |
| 4 | Scale & enterprise | S1–S8 | ~88 (S6 SOC 2 counted as 30; open-ended) |
| | **Total** | | **~252** |

Suggested sequencing: R0 → (R1, R4, R5, R9, R11 in parallel) → R2/R3/R10 → R6/R7/R8 → Phase 2 items (A11 early, alongside A4) interleaved with Phase 3 by customer demand. Critical path to a first customer is R0, R1–R3, R6, R8 (about 37 engineer-days, ~4 weeks with two engineers, provider lead times aside).

## Phase 1 — Critical issues

| ID | Problem → Proposed solution | Business value / technical impact | Depends on | Pri | Days | Risk | Acceptance criteria |
|---|---|---|---|:--:|---:|:--:|---|
| R0 | CI is red (`eslint .` 164 errors) and there is no CD or scanning (S-08, TD-01, TD-02). → Fix lint (type `soft-delete.ts`, tests), add required status check, Dependabot, `pnpm audit`, gitleaks, CodeQL; add coverage report | Trustworthy gate; prevents regressions in everything below. Touches many files mechanically | – | P0 | 3 | Low | `pnpm lint && pnpm typecheck && pnpm test` green on `main`; branch protection requires `verify`; scheduled security scans run |
| R1 | Scheduled campaigns likely never launch (S-04, TD-03). → `list_due_campaigns()` SECURITY DEFINER function + sweep rewrite + integration test on app role | Restores a core promised feature. Small migration + service change | R0 | P0 | 1.5 | Low | Test: schedule campaign for +1 min with app-role connection → status RUNNING within 2 min; sweep test added (A2) |
| R2 | Non-idempotent campaign sender (S-02, TD-04). → Atomic claim (`FOR UPDATE SKIP LOCKED` → `SENDING` with lease), recipient-id idempotency in provider metadata, status CAS on launch, deterministic job id, backoff on 429/131056, lease reaper | Prevents duplicate sends and number-quality damage. Changes `dispatchBatch`, schema (lease cols) | R1 | P0 | 6 | Med | Chaos test: kill worker mid-batch, run 3 concurrent dispatchers → each recipient sent exactly once; provider 429 slows, not fails, the campaign |
| R3 | Marketing sent without opt-in (S-01, E2, TD-05). → ConsentLedger (+backfill), eligibility service, preview counts "no opt-in", import attestation, template-category rule | Compliance (WhatsApp policy, DPDP); required for sales to regulated tenants. New table, touches inbox/import/campaigns | R2 | P0 | 6 | Med | Lead with no `OPTED_IN` is never selected for MARKETING; ledger rows carry source+timestamp; opt-out via STOP still immediate; docs updated |
| R4 | Email tracking exposes tenant-wide data (S-05, TD-06). → `email:read:own|all`, `email:suppress:manage`, scope queries by assignee/sender, extend matrix test | Closes intra-tenant data exposure and suppression tampering. Permission catalog +3, role sync | R0 | P0 | 2.5 | Low | Agent sees only own-lead emails; cannot delete suppressions; matrix test covers it |
| R5 | Google OAuth lacks state/PKCE; unvalidated body (S-03, S-16, TD-07). → Redis-stored state bound to session+membership, PKCE, Zod body, fixed redirect URI, show connected account | Prevents calendar account-linking attack | R0 | P0 | 2 | Low | Callback with missing/forged state → 400; test covers; UI confirms account |
| R6 | Nothing verified live (S-07, E1, TD-08). → Run live-verification kit for OpenAI, Razorpay test, WhatsApp sandbox, SMTP/SES, Embedded Signup; log defects; fix | De-risks the whole product. Likely produces a fix list (budget +50 %) | Provider accounts | P0 | 10 | High | Signed checklist for each provider with recorded fixtures; `docs/live-verification.md` status updated; defects triaged |
| R7 | Bounce/complaint correlation (S-06). → Send via SES API with configuration set & tags (or custom header), store real SES id, replay real SNS payload fixture | Working suppression → deliverability. Replaces mail path for tracked emails | R6 | P1 | 3 | Med | Real bounce in SES sandbox creates suppression and updates status |
| R8 | No production baseline (TD-09). → Terraform/CDK for staging, deploy via CI, run `backup-restore-drill.sh`, dashboards + alerts live, WAF | Ability to ship and operate. Infra-as-code | R0, R6 | P0 | 10 | Med | Staging runs from CI; restore drill RPO/RTO recorded; alert fires in a game day |
| R9 | Small exposures: `/docs` always on, `/design/*` in prod, literal secret fallback, platform-admin MFA optional (S-11, S-13, S-14, S-18, TD-10). → Gate/remove; enforce MFA and fail boot on unsafe production flags | Hygiene | – | P1 | 1 | Low | Production returns 404 for `/docs`, `/design/*`; missing `TRACKING_SECRET` fails boot; platform login without MFA is refused in production |
| R10 | Google Calendar live path likely broken (S-19, TD-31): no token refresh, credentials read outside tenant context, errors swallowed. → Refresh-token exchange with expiry check and persisted update, read credentials inside the tenant tx, `status`/`lastError` on the card, live-mode test under RLS | Calendar sync actually works beyond the first hour; fewer double bookings. Touches `google-calendar.service.ts`, card UI | R5 | P1 | 3 | Low | Token older than 1 h is refreshed automatically; revoked token shows 'reconnect' in UI; push succeeds under the app role in an integration test |
| R11 | DPDP erasure misses email data (S-20, TD-33). → New migration replacing `erase_lead()` to delete `tracked_emails` and `email_engagement_events` for the lead; table-driven registry + test that fails when a table with `lead_id`/recipient PII is unregistered | Closes a legal exposure. One migration + test | – | P1 | 1.5 | Low | After `POST /privacy/leads/:id/erase` no row in any table references the lead's email, phone or IP; test enumerates tables |

## Phase 2 — Architectural improvements

| ID | Problem → Solution | Value / Impact | Depends | Pri | Days | Risk | Acceptance criteria |
|---|---|---|---|:--:|---:|:--:|---|
| A1 | 36 FKs / 81 models (S-09, TD-11). → Orphan scan, FKs `NOT VALID` then `VALIDATE`, tenant FKs, simplify purge | Integrity defence-in-depth | R8 (staging) | P1 | 6 | Med | Zero orphans; FKs validated in staging then prod; purge tests pass |
| A2 | Cross-tenant system sweeps untested on the RLS-bound role (TD-12, S-04). → Test every worker sweep with no tenant context; document the `SECURITY DEFINER` list-function pattern | Prevents silent no-op jobs | R1 | P1 | 1 | Low | CI fails if a sweep returns nothing where rows exist |
| A3 | `ops/` god module, controllers in `*.module.ts`, 800–976-line services (TD-13, TD-14). → Split into `scheduling`, `automation`, `notifications`, `kernel`; move controllers; boundary lint | Velocity, onboarding, safer change | R0 | P1 | 8 | Med | No `ops/` > 10 files; dependency-cruiser rule passes; no behavioural change (tests green) |
| A4 | Mutable-callback wiring in `JobsService` (TD-15). → Processor registry; boot fails on missing processor | Removes silent no-op jobs | A3 | P1 | 2 | Low | Removing a processor makes startup fail in tests |
| A5 | External I/O inside DB tx, swallowed errors (S-10, TD-16). → Outbox event `appointment.calendar_sync` + worker retry + status surfaced | Reliability of appointments | A4 | P1 | 3 | Low | GCal outage doesn't slow booking; failed syncs visible & retried |
| A6 | Two tx per request, no pool/timeout settings (TD-17). → Permission cache, pool size, `statement_timeout`, PgBouncer | Throughput headroom | R8 | P1 | 4 | Med | Load test shows ≥ 30 % fewer DB round trips per request; role change takes effect < 60 s |
| A7 | Dual API-client strategy (TD-18). → Generated client only, migrate incrementally | Contract safety | R0 | P2 | 10 | Low | 0 imports of hand-written route strings in feature code; codegen drift fails CI |
| A8 | No internal idempotency (API-5, TD-19). → `Idempotency-Key` on side-effect endpoints | Prevent double sends | R2 | P1 | 3 | Low | Replayed key returns original response |
| A9 | Oversized services (TD-14). → Split `email-tracking` (token/instrument, sender, events/stats) and `campaigns` (segment, launch, sender) | Maintainability | A3 | P2 | 5 | Low | Files < 400 lines; coverage unchanged |
| A10 | No coverage/contract tests (TD-20). → v8 coverage ratchet; provider fixture replay; E2E for campaigns/emails/roles/GCal | Regression safety | R6 | P2 | 4 | Low | Coverage report in CI; new E2E specs green |
| A11 | AI reply turns not durable (TD-32). → Delayed queue job per conversation replacing in-memory debounce, sweeper re-queues unanswered inbound after N minutes | No lost AI replies on deploy/restart | A4 | P1 | 3 | Low | Killing the API during the debounce window still produces one reply; sweeper test |

## Phase 3 — Product completeness

| ID | Problem → Solution | Value / Impact | Depends | Pri | Days | Risk | Acceptance criteria |
|---|---|---|---|:--:|---:|:--:|---|
| P1 | Campaign gaps (E3, E10, W3). → entitlements + metering, retry-failed, test-send, template status, quiet hours, analytics (delivery/read/reply/lead conversion) | Monetisable, safer | R2, R3 | P1 | 10 | Med | Plan caps enforced; usage page shows campaign volume; retry creates new idempotency keys |
| P2 | Email deliverability & stickiness (E4, W2). → Unsubscribe + one-click header, templates, domain health | Deliverability | R7 | P1 | 8 | Med | Unsubscribe suppresses within 1 min; header passes Gmail/Yahoo bulk-sender checks |
| P3 | No lead-source integrations (E5). → Meta Lead Ads webhook + Zapier/Make app over `/v1` | Lead flow without manual work | R6 | P1 | 10 | Med | Lead Ads sample creates lead with source & consent flag |
| P4 | No telephony (E6). → Call-log webhook (Exotel/Knowlarity), timeline entries | Complete 360° | – | P2 | 6 | Low | Inbound call creates activity linked to lead by phone |
| P5 | No mobile push (E7). → PWA manifest, service worker, Web Push for inbound & SLA | Faster response | – | P1 | 6 | Med | Installable; push arrives for new inbound |
| P6 | Basic reports (W5). → Scheduled email reports, funnel and source attribution | Owner value | – | P2 | 8 | Low | Weekly report email; funnel matches pipeline data |
| P7 | English-only UI (W8). → Complete `t()` migration, add Hindi | Market fit | – | P2 | 6 | Low | Language switch persists; no hard-coded strings in top 10 screens |
| P8 | One-way calendar sync (W1). → Two-way via watch channels, conflict handling | Fewer double bookings | A5 | P2 | 6 | Med | External event blocks slot within 1 min |
| P9 | Row-capped sync import/export (5,000 / 50,000 rows) (W4, TD-21). → Queued import, row error report, streamed export, truncation warning | Large tenants, migrations | A6 | P2 | 5 | Low | 100k-row import completes without request timeout; export of > 50k rows is complete or clearly flagged |

## Phase 4 — Scalability and enterprise readiness

| ID | Problem → Solution | Value / Impact | Depends | Pri | Days | Risk | Acceptance criteria |
|---|---|---|---|:--:|---:|:--:|---|
| S1 | No per-tenant fairness (doc 09 §4). → Dedicated `campaigns` tier, per-tenant token bucket | Noisy-neighbour protection | R2, A6 | P2 | 5 | Low | One tenant's 100k blast does not delay another tenant's AI reply > SLO |
| S2 | Limited traces. → OpenTelemetry HTTP→DB→queue→provider | Faster incident response | R8 | P2 | 4 | Low | Trace for an inbound WhatsApp message spans API, outbox, AI |
| S3 | Unbounded tables (P12). → Monthly partitions for `messages`, `lead_activities`, `email_engagement_events` | Long-term performance | A1 | P3 | 5 | Med | Partition-pruned queries; retention drops partitions |
| S4 | No SSO/SCIM (N1). → SAML/OIDC login + SCIM users | Enterprise deals | A3 | P3 | 15 | Med | Okta/Azure AD login & deprovision works |
| S5 | Audit export/tamper evidence (S-17, W6). → Export, hash chain, WORM sink | Compliance | – | P3 | 4 | Low | Verified chain; export under 1 min per 1M rows |
| S6 | SOC 2 readiness (N6). → Controls, evidence automation, access reviews | Enterprise trust | R0, R8 | P3 | 30+ | Med | Type I audit ready |
| S7 | Residency/dedicated DB (N3). → Regional stack + DB router | Large accounts | A1, R8 | P3 | 20 | High | Tenant pinned to region; no cross-region reads |
| S8 | Voice notes (E8). → Transcription pipeline | AI coverage | R6 | P3 | 5 | Low | Voice message gains transcript within 30 s |

## Risks to the plan
- Live verification (R6) may reveal provider-specific changes (e.g., payload shapes, template categories, SES ids); keep 50 % contingency.
- Phase 2 refactors touch core files while Phase 3 features land; use feature flags and short-lived branches, rely on the security matrix and integration suite.
- Dependency majors (Next 16, React 19.3, Nest 12, TS 6, Zod 4) may need patch upgrades; budget ~3 days per quarter.
