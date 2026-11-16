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

## Known gaps / accepted for now
- Rate limiting is **in-memory per instance**; the Redis store arrives in Phase 5. Do not run multiple API replicas before then.
- Email-verification is not enforced for login (only for inviting teammates).
- No MFA. [V1.1+]
- Platform-admin surface (separate auth, ADR-0003) not built until Phase 6.
- CSP is the Helmet default on the API only; the Next.js app has no custom CSP yet (Phase 7 hardening).
- Mobile/responsive layouts were **not** verified in a real narrow viewport.
