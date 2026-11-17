# Threat model

Scope: identity, tenancy, RBAC, audit. Extended in each phase (webhooks Phase 3, AI Phase 4, billing Phase 6).

| Threat | Mitigation | Evidence |
|---|---|---|
| Cross-tenant read/write via API | tenant derived from validated membership, never from input; every query in a tenant-scoped transaction | `apps/api/test/tenancy.test.ts` |
| Same, if app code is buggy | PostgreSQL RLS on every tenant table; app role is non-owner, non-superuser | `packages/database/test/rls-isolation.test.ts` (incl. a guard that fails if a table with `tenant_id` lacks RLS) |
| Forged token claiming another tenant | membership re-checked per request | "forged token" test |
| Privilege escalation via roles/invites | can only grant roles whose permissions you hold; no self role change; last-owner protection | RBAC tests |
| Credential stuffing / brute force | argon2id, per-IP throttling (429), account lockout, identical errors for all failures, dummy hash for unknown users | auth + rate-limit tests |
| Refresh token theft | rotation + reuse detection revokes the whole family; access token tied to a revocable session | rotation test |
| Account enumeration | same response for existing/new email on register, forgot-password | tests |
| CSRF on cookie auth | httpOnly + SameSite=Lax cookies and an Origin check on unsafe methods | CSRF test |
| Token leakage from DB | verification/reset/invite/refresh tokens stored as SHA-256 hashes, single use, expiring | code review |
| Audit tampering | app role has INSERT+SELECT only on `audit_logs` | DB test |
| Information leakage in errors | structured errors with request id; internals logged server-side only | error-hygiene test |

## Phase 3 additions
| Threat | Mitigation | Evidence |
|---|---|---|
| Forged / replayed WhatsApp webhooks | per-channel HMAC over raw body (constant-time), unguessable URL key, payload must match the channel's number, de-dup by body hash and by provider message id | `communication.test.ts` (forged, missing, wrong-secret, other-tenant-secret, altered-bytes, duplicate, re-wrapped replay) |
| Provider token theft from the database | envelope encryption (AES-256-GCM, per-record key wrapped by master key, tenant+provider authenticated); secrets never returned by APIs or written to audit logs | secret-box tests, DB ciphertext check |
| Messaging someone who opted out / outside the window | enforced server-side before sending (24 h window, STOP keywords, template registry, consent required for templates) | outbound rules tests |
| Other websites abusing a widget key | allow-listed origins per widget; sessions bound to the key | widget tests |
| Visitor reading another person's chat | one thread per contact but history limited to messages after the session started | widget tests |
| Agents reading others' conversations | `conversation:read:own` scoping returns 404; SSE events filtered by assignment | inbox + SSE tests |
| Stored XSS via customer text / filenames | UI renders text as text; widget uses `textContent`; media forced to download unless a safe image type, `nosniff`, sandbox CSP | media test, widget script check |
| SSRF through media URLs | host allow-list (Meta domains) before fetching | code review (live client only) |

## Phase 4 additions
| Threat | Mitigation | Evidence |
|---|---|---|
| Prompt injection via customer messages | delimiters + "data, not instructions" rule; strict tool schemas; tool allow-list; deterministic gates before the model | injection corpus test (every attack is obeyed by a scripted "compliant" model, yet no forbidden call succeeds and nothing reaches the customer) |
| Injection via uploaded documents | instruction-like sentences stripped at ingestion; retrieved text delimited; owner informed | poisoned-document test |
| Model invents prices / links / phone numbers | output guards with one retry, then handover | guard tests, "never invents facts" tests |
| System-prompt exfiltration | canary in the confidential section; reply blocked if it appears | leak tests |
| Model reaches another tenant's data | tenant/lead from server context only; strict args reject extra ids; RLS + explicit tenant filter on retrieval and tools; request payloads inspected in test | cross-tenant context test |
| Runaway AI cost | monthly token cap (hard stop → handover), platform kill switch, per-tenant usage metering, 5-iteration tool loop limit | cap + kill-switch tests |
| Malicious uploads | extension + declared type + magic bytes, 10 MB cap, ClamAV scan (fail closed), tenant-prefixed keys, parsing in an isolated worker, download as attachment | upload tests incl. real ClamAV + EICAR |
| Silent score manipulation | overrides need permission + reason, are timestamped, audited and visible in history | scoring API tests |

## Phase 5 additions
| Threat | Mitigation | Evidence |
|---|---|---|
| Double booking / race to the same slot | Postgres exclusion constraints (agent and customer), not application checks | 12-way concurrent test |
| Background jobs crossing tenants | four narrow `SECURITY DEFINER` functions; every other job step runs in a tenant transaction under RLS; new tables covered by the RLS guard test | DB isolation tests |
| Automation storms / loops that spam customers | origin + depth tracking (max 3), self-trigger ignored, per-lead cooldown, unique run per (automation, event), idempotency keys on sends | loop test, idempotency test |
| Messaging someone who did not consent or opted out | automation sends use the same consent / 24h window / template registry checks as a human; refusals are recorded skips | WhatsApp action tests |
| Duplicate side effects on retry or double delivery | compare-and-set run claim, per-step persistence, event_marks, outbox lease | retry and scanner tests |
| AI invents or books an unavailable time | tool re-validates the exact slot server-side; lead and tenant from server context; output guard blocks times no tool returned | scheduling tests |
| Notification leakage between users/tenants | notifications are queried by the caller's membership only; SSE delivery filtered by membership | notification tests |
| Brute force across multiple API replicas | rate-limit counters in Redis (atomic Lua) | verified live |

## Phase 6 additions
| Threat | Mitigation | Evidence |
|---|---|---|
| Forged / replayed payment webhooks (free upgrade, fake invoices) | HMAC over the raw body (constant-time), unique `(provider, event_id)`, idempotent handlers, payments unique by provider id, tenant resolved from the subscription id not the payload | `billing.test.ts` (forged, tampered, missing signature, duplicate event, same payment under a new event id) |
| Out-of-order events reviving a cancelled/expired plan | state-guarded handlers, row lock per workspace, stale-subscription events ignored | cancel + late-renewal test |
| Using features/limits beyond the paid plan | enforced in the backend (guard, services, AI, automations, sends), never in the UI | gating tests (feature, seats, automations, AI cap, downgrade over-quota) |
| Lapsed customer loses data or is locked out of paying | read-only mode (reads, export and billing stay open); nothing deleted | dunning tests |
| Invoice tampering / gaps (GST) | invoices immutable to the app role; gap-free numbering inside the invoice transaction | concurrent-numbering test, DB permission test |
| Cross-tenant billing data access | RLS on subscriptions, billing profiles, invoices, payments | RLS guard test, invoice isolation test |
| Platform console takeover | separate secret + audience, strict cookie, lockout, identical errors, per-request admin check, CSRF origin check, admins creatable only by the schema owner | `platform.test.ts` |
| Tenant code reading/writing platform audit data | RLS: visible only with no tenant in scope | RLS test |
| Console actions without accountability | required reason, append-only platform log + mirrored tenant audit entry | platform tests |

## Phase 7 additions
| Threat | Mitigation | Evidence |
|---|---|---|
| A newly added route is accidentally public or unprotected | route inventory test: public allow-list, 401-without-credentials sweep, reviewed list of service-enforced routes | `security-matrix.test.ts` |
| Token exfiltration via media URL / redirect (SSRF) | HTTPS + exact Meta hosts + no userinfo/port + no redirects + size cap | media guard tests |
| Customer message lost after a crash mid-webhook | stale unfinished webhook events are re-processed on redelivery | `webhook-recovery.test.ts` |
| XSS/clickjacking/mixed content in the web app | CSP, frame denial, nosniff, referrer and permissions policies, HSTS | headers in `next.config.ts` (E2E checks them) |
| Data-principal erasure leaves personal data behind | one `SECURITY DEFINER` function deletes across 15+ tables (incl. raw webhook payloads and merged duplicates), tenant verified, content-free audit | `privacy.test.ts` |
| Operator error during recovery | restore drill script verifies counts, RLS, grants, constraints, isolation | `scripts/backup-restore-drill.sh` |
| Mail credentials or content in clear | STARTTLS/TLS required in production, authenticated SMTP | env validation |

## Known gaps / accepted for now
See `docs/security-review.md` for the current prioritised list. Phase 8 built the KMS provider, Turnstile bot protection, TOTP MFA (including the platform console), and the retention purge, all verified with mocks or locally only.

## Historical gaps (Phases 1-6; status updated after Phase 8)
Closed in Phases 7-8 (locally verified only): platform-console MFA and user MFA; the Next.js CSP; the webhook payload retention job; bot protection on the widget; mobile/responsive layouts (Chrome emulation, 375 and 768 px).
- **Razorpay has never been called for real.** The live client follows the documented API; every billing test uses the mock provider (with real HMAC signatures). Verify with test-mode keys before relying on it.
- Invoice SAC code / layout not reviewed by an accountant.
- Platform-admin impersonation is not built (deliberately).
- Platform console has no MFA.
- **No real LLM has ever been connected.** The live OpenAI client is untested; offline results validate the pipeline only. Hindi/Hinglish quality, tone, real extraction accuracy and real injection resistance are **unmeasured** until the live eval (`EVAL_LIVE=1`) is run with a key.
- Injection-pattern list for documents is heuristic.
- AI turns still run in-process after a short debounce; the minute scanner re-triggers a customer message left unanswered for 90 seconds to 6 hours (once). A crash mid-turn leaves a stale RUNNING run that expires after 3 minutes.
- Knowledge ingestion is also in-process (a restart during processing leaves a document in PROCESSING; use Reprocess).
- Voice notes are not transcribed (V1.1). The assistant sees "[customer sent an audio]".
- **The live WhatsApp client has never run against Meta.** Everything is tested with the mock provider. Payload shapes follow Meta's documented format, but real-world verification needs real credentials.
- Webhook raw payloads are stored (for dedupe and debugging) without a retention job yet (phase 7).
- Widget polling is not authenticated beyond the session token and origin allow-list; scripted abuse is bounded only by rate limits until bot protection (phase 7).
- Rate limiting is Redis-backed (phase 5); it degrades to per-instance memory if Redis is unreachable.
- Email-verification is not enforced for login (only for inviting teammates).
- No MFA. [V1.1+]
- CSP is the Helmet default on the API only; the Next.js app has no custom CSP yet (Phase 7 hardening).
- Mobile/responsive layouts were **not** verified in a real narrow viewport.


## Phase 8 (F3): public API, webhooks, reports, support access
| Threat | Mitigation | Evidence |
|---|---|---|
| Leaked/over-broad API key | hashed storage, shown once, scopes mapped to a fixed permission set (never team/billing/settings), expiry, revocation, per-key rate limit, plan gating, last-used and counters | `public-api.test.ts` (scope matrix, forged/revoked/expired, rate limit) |
| Session token used as an API key or the reverse | different guards and token formats; `/v1` rejects JWTs, tenant routes reject keys | tests |
| Cross-tenant API access | tenant derived from the key; RLS applies to every query | cross-tenant tests |
| Duplicate side effects on client retries | `Idempotency-Key` with request-hash check | idempotency tests |
| SSRF through webhook URLs (cloud metadata, internal services, rebinding, redirects) | https only, resolve once and connect to the pinned public address, blocklist incl. IPv6 embeddings, no redirects, timeouts, size caps, same check at save and at send | `safe-http.test.ts` (68 cases), `webhooks-outbound.test.ts` |
| Forged or replayed webhooks at the receiver | HMAC-SHA256 over `timestamp.body` with per-endpoint secret, timestamp for replay windows, rotatable secrets (encrypted at rest) | signature tests |
| Personal data leaving via webhooks | payloads carry ids only | payload tests |
| Failing receiver causing unbounded load | backoff, attempt cap, endpoint auto-disable with owner notice, lease-based claiming | retry/disable tests |
| Reports leaking other people's/tenants' data | tenant-scoped SQL, agent scope = own records, manager-only reports, export audited and plan-gated, CSV formula neutralised | `reports.test.ts` |
| Support access abused (reads secrets, writes, outlives its purpose, goes unnoticed) | read-only at the auth guard on every route, blocklist for secrets/people/money/exports, 30-minute cap checked per request, password re-entry, reason required, own token audience, banner + owner notice + dual audit trail, owner kill switch | `support-access.test.ts` (12) |
**Accepted/known:** a support session can read personal data by design (controls are reason, notice, audit); support tokens replace the workspace cookie in that browser; webhook ordering is not guaranteed.

## Automation graph (Phase 9)
| Threat | Mitigation | Evidence |
|---|---|---|
| A definition is edited after it was reviewed, to change what in-flight runs do | every run is pinned to an immutable version (`automation_versions`: app role has SELECT and INSERT only, RLS by tenant); edits apply to new events only; saves are compare-and-set on the version (409 on a stale save) | `automation-graph.test.ts` (pinning, 409), DB grants |
| Someone without the right edits automations | `automation:manage` (owner and manager) on every route, plus the `automations` plan feature; audit entry for create, update, enable, disable, delete | `security-matrix.test.ts`, `automation.test.ts` |
| Messaging someone who opted out, or after the world changed during a wait | opt-out ends every waiting run for the lead (checked on each inbound message and again at resume); at resume the run re-checks automation enabled, plan, lead and consent; consent, the 24 h window and the template registry still apply at every send | wait tests (STOP, disable, plan) |
| Duplicate sends on retry or resume | per-node idempotency keys (`runId:nodeId`), branch and wait decisions persisted and never re-decided, compare-and-set resume (a reply and the deadline arriving together resume once) | retry and resume tests |
| Resource exhaustion through huge or deeply nested definitions, or a flood of waiting runs | limits enforced on the server, not only in the UI: 25 nodes, 12 actions, depth 12, 3 waits per path, wait at most 30 days, 64 KB; the scanner resumes at most 200 runs per workspace per minute; a stored definition that cannot be read is skipped, not retried forever | `validateGraph` tests, limits tests |
| Cycles or loops that spam customers | graphs must be acyclic; automation-to-automation chains stop at depth 3; per-lead cooldown also counts waiting runs | cycle, loop and cooldown tests |
| Injection through template placeholders | placeholders are replaced in one pass from a fixed list of fields; a lead name containing `{{...}}` is not expanded again; unknown placeholders become empty text; text is rendered as text | `render` tests |
| SSRF or code execution via automations | none: the vocabulary is closed (ADR-0029); no step fetches a URL, runs code or takes a template language | design |
| Cross-tenant access to graphs, versions or runs | tenant derived from the session; RLS on `automations`, `automation_versions`, `automation_runs`; every lookup also filters by tenant | isolation tests |
**Accepted/known:** a crash between an action and its saved step can repeat a task or notification (not a send); the dry-run endpoint writes a `DRY_RUN` row per call and relies on the global rate limit; clinics must keep automation text free of health details (the clinic templates are written that way and a test checks them).
