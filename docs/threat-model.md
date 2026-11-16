# Threat model (Phase 1 baseline)

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

## Known gaps / accepted for now
- **No real LLM has ever been connected.** The live OpenAI client is untested; offline results validate the pipeline only. Hindi/Hinglish quality, tone, real extraction accuracy and real injection resistance are **unmeasured** until the live eval (`EVAL_LIVE=1`) is run with a key.
- Injection-pattern list for documents is heuristic.
- AI turns run in-process after a short debounce; BullMQ/worker (phase 5) will add durable queues and retries across restarts. A crash mid-turn leaves a stale RUNNING run that expires after 3 minutes.
- Knowledge ingestion is also in-process (a restart during processing leaves a document in PROCESSING; use Reprocess).
- Voice notes are not transcribed (V1.1). The assistant sees "[customer sent an audio]".
- **The live WhatsApp client has never run against Meta.** Everything is tested with the mock provider. Payload shapes follow Meta's documented format, but real-world verification needs real credentials.
- Webhook raw payloads are stored (for dedupe and debugging) without a retention job yet (phase 7).
- Widget polling is not authenticated beyond the session token and origin allow-list; scripted abuse is bounded only by rate limits until bot protection (phase 7).
- Rate limiting is **in-memory per instance**; the Redis store arrives in Phase 5. Do not run multiple API replicas before then.
- Email-verification is not enforced for login (only for inviting teammates).
- No MFA. [V1.1+]
- Platform-admin surface (separate auth, ADR-0003) not built until Phase 6.
- CSP is the Helmet default on the API only; the Next.js app has no custom CSP yet (Phase 7 hardening).
- Mobile/responsive layouts were **not** verified in a real narrow viewport.
