# Security review (Phase 7, 2026-11-16)

Scope: authorisation, tenant isolation, SSRF, file access, rate limits, sensitive-data exposure, transport/headers, dependencies, webhooks, billing, platform console, data-subject rights. Method: code review of the surfaces above, automated route inventory (`apps/api/test/security-matrix.test.ts`), targeted tests, `pnpm audit`. **This was a self-review by the developer agent, not an independent penetration test.** An external review before launch is recommended.

## What the automated guards now enforce (CI)
- Every route is discovered at test time. **Public routes** must be on a reviewed allow-list (adding one fails the test). **Every non-public route returns 401 without credentials.** Platform routes other than login/logout are guarded by `PlatformGuard`.
- Every tenant route that does **not** declare `@RequirePermissions` must be on a reviewed "service-enforced" list (own-vs-all scoping, `lead:delete`, etc.); a new undeclared route fails the test. The service-enforced rules are tested behaviourally with an agent role (cannot delete, export, merge, bulk-edit, override scores, change SLA; cannot see colleagues' leads: 404).
- Owner/manager-only areas return 403 to an agent (team, audit, billing, integrations, AI settings, knowledge, automations, usage, channels).
- Responses contain no password/token hashes or provider secrets; errors carry a request id and no stack/SQL.
- Security headers on API responses, no `x-powered-by`, CORS reflects only the configured web origin (never `*`) with credentials.
- RLS coverage guard (every table with `tenant_id` has RLS), including the platform audit table.

## Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium-High | A crash between "WhatsApp webhook recorded" and "processed" made Meta's redelivery look like a duplicate: the customer's message was silently lost | **Fixed**: unfinished events older than 45 s are re-processed on redelivery (ingest is idempotent); test `webhook-recovery` |
| 2 | Medium | WhatsApp media download followed redirects and accepted any port/credentials on Meta hostnames, with no size cap: the bearer token could be sent elsewhere via a redirect | **Fixed**: HTTPS only, exact Meta hosts, no userinfo/port, `redirect: 'error'`, 25 MB cap; tests for 8 bad URLs |
| 3 | Medium | The web app sent no CSP, framing or referrer protections | **Fixed**: CSP (no framing, no foreign form targets, connections only to our API and Razorpay, no plugins), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production. `script-src` still needs `'unsafe-inline'` (see open items) |
| 4 | Medium | Production SMTP could not authenticate and did not require TLS (blocks SES and sends mail in clear on 25) | **Fixed**: `SMTP_USER`/`SMTP_PASS`, STARTTLS required in production (implicit TLS on 465) |
| 5 | Low | Open-redirect variant after login with `next=/\evil.example` | **Fixed** (only `/path` accepted, not `//` or `/\`) |
| 6 | Low | `.env.example` was not itself a valid configuration (empty optional secrets failed validation) | **Fixed** (`KEY=` means unset); test keeps `.env.example` valid |
| 7 | Low | Queries issued concurrently on one transaction connection (deprecated in `pg`, removed in pg 9) | **Fixed** (14 sites → `series()`) |
| 8 | Low | `GET /roles` visible to every member (role names and permission keys) | **Accepted**: not sensitive; UI needs it |
| 9 | High (compliance) | No way to honour a data principal's erasure or access request | **Mitigated**: `POST /privacy/leads/:id/erase` (owner only, irreversible, confirmation + reason, one audited `SECURITY DEFINER` function, content-free audit entry) and `GET /privacy/leads/:id/export`; tested across all tables. **Phase 8 added:** UI for lead export/erasure, tenant-wide export (async, owner-only), tenant deletion with cooling-off + table-complete purge, retention job. **Still open:** streaming export for very large workspaces; legal confirmation of what must be retained after deletion (invoices) and of retention defaults; backups keep purged data until they age out |

## Open items (not fixed)
| Severity | Item | Why open / what is needed |
|---|---|---|
| ~~High for production~~ **Built, unverified against AWS** | Master key was local-only | `KEY_PROVIDER=kms` (AWS KMS envelope), per-record key ids, re-wrap script, production refuses the local key unless explicitly accepted (ADR-0047). Tested with a fake KMS only: **run it against a real KMS key in staging before launch** |
| ~~Medium~~ **Built, unverified against Cloudflare** | No bot protection on public endpoints | Turnstile server verification (fail closed) on register, login, forgot-password and widget sessions, web forms and `widget.js` wired; `off` refused in production without an explicit override (ADR-0048). Needs real Turnstile keys and a browser test; lead-capture (API-key) endpoints are not challenged |
| ~~Medium~~ **Built (TOTP)** / Open | No MFA | TOTP MFA for users and platform admins with recovery codes, lockout, replay protection, workspace and platform requirement switches (ADR-0049); tested and set-up/sign-in verified in a real browser for tenant users. **Still open:** email verification is not enforced at login; no WebAuthn; no admin MFA-reset UI; platform second step not browser-tested |
| Medium | CSP `script-src 'unsafe-inline'` (Next bootstrap scripts) | A nonce-based CSP requires dynamic rendering of every page |
| ~~Medium~~ **Closed (Phase 8)** | Raw webhook payloads stored without a retention job | Daily retention purge (default 30 days, per-workspace, platform minimum), tested; see ADR-0053 |
| Low | Platform console has no IP allow-list/WAF; impersonation deliberately absent | Deployment-level control |
| Low | Rate limiting is per IP; behind a load balancer `trust proxy` is `1` (one hop) | Correct for one ALB; adjust if CloudFront/another proxy is added |
| Info | `pnpm audit --prod`: no known vulnerabilities at review time | Re-run in CI/regularly |

## Gate statement
The Phase 7 gate says "no open high-severity findings". **Honest status:** the one high compliance gap (no erasure/export) now has a tested mechanism for the main case (one lead). The three blockers (KMS key provider, bot protection, MFA) are now built and tested with doubles; **KMS and Turnstile must still be exercised against the real services**, and an independent review is still recommended.
