# ADR-0041 to 0046: hardening and launch readiness (Phase 7)

Status: accepted (2026-11-16)

## ADR-0041 Security is enforced by inventory tests, not by memory
The API route table is discovered at test time and checked: public routes against a reviewed allow-list, every protected route returns 401 anonymously, and every tenant route without `@RequirePermissions` against a reviewed list of "service-enforced" routes (whose rules have behavioural tests). A new route therefore cannot become public or unprotected silently. **Cost:** adding a route to those lists is a deliberate, reviewed edit.

## ADR-0042 Data-principal rights through one audited database function
Erasure of a lead is `erase_lead(tenant, lead)`, a `SECURITY DEFINER` function that deletes across all tables holding the person's data (including raw webhook payloads and merged duplicates) after verifying the lead belongs to the tenant. The application role was **not** given broad `DELETE` grants on consents, messages, appointments, etc.; it can only call this function. The API requires the owner role, an explicit `confirm: "ERASE"` and a recorded reason; the audit entry stores counts only. Export is a read-only JSON bundle. Tenant-wide export/deletion, retention policies and a UI are not built.

## ADR-0043 Sequential queries inside transactions
`Promise.all` over queries on one interactive-transaction connection only queued them while triggering a deprecated `pg` pattern (removed in pg 9). They run through `series()` instead (same latency, typed tuple result).

## ADR-0044 Observability without new infrastructure (for now)
One JSON access-log line per request (route pattern, status, duration, request/tenant/user ids; no query strings, bodies or raw ids) on stdout, on by default in production; `/health` (liveness) and `/health/ready` (database required, Redis reported). SLIs that can be computed from logs and tables today are listed in `docs/slos-and-alerts.md`. OpenTelemetry, Sentry and Prometheus metrics are **not** built.

## ADR-0045 Recoverability is drilled, not assumed
`scripts/backup-restore-drill.sh` dumps, restores into an empty database (extensions created by a superuser first, as on RDS) and verifies counts, RLS, policies, grants, constraints, functions and tenant isolation as the application role. Result recorded in `docs/runbooks/database-backup-restore.md`. A managed-database PITR restore has not been drilled.

## ADR-0046 End-to-end tests run the production build on separate ports
Playwright runs against `next build` output (so the production CSP is exercised) and the compiled API on ports 3200/4100, with its own queue prefix, using the installed Chrome. It never touches the developer's own servers.
