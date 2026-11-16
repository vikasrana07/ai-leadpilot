# Database backup and restore

Postgres 17 with extensions `vector`, `citext`, `btree_gist`, `pgcrypto`, `pg_trgm`. Two roles: `leadpilot_owner` (owns schema, runs migrations) and `leadpilot_app` (runtime; NOSUPERUSER, NOBYPASSRLS). A restore that loses the roles or grants silently disables tenant isolation, so **always run the verification section**.

## Backups (RDS reference; unverified)
- Automated backups on, retention >= 7 days (set per your RPO), point-in-time recovery enabled. Multi-AZ for availability (not a backup).
- Before every risky migration: manual snapshot.
- Logical backup (additional, portable), as the owner role:
  ```
  pg_dump --format=custom --no-owner=false --file=leadpilot-$(date +%F).dump "$DATABASE_OWNER_URL"
  ```
  Store encrypted in a separate account/region. The dump contains personal data and envelope-encrypted provider secrets: treat it as production data.
- Object storage (S3) is not in the database: enable bucket versioning for the knowledge-base files (tenant data lives under `tenants/<tenantId>/`).
- **The master key (`LOCAL_MASTER_KEY` today) is not in any backup.** Provider tokens in `integration_credentials` are unreadable without it. Back it up separately in your secret manager.

## Restore: point in time (RDS)
1. Restore to a **new** instance at the chosen timestamp (never over the live one). 2. Wait for it to become available. 3. Run verification below against the new instance. 4. Repoint `DATABASE_URL`/`DATABASE_OWNER_URL` (or swap endpoints) and restart api + worker. 5. Re-check `/health/ready`.

## Restore: logical dump into an empty database
```
createdb leadpilot_restore                                  # as an admin; then create roles/extensions as in infrastructure/docker/postgres-init.sh
pg_restore --dbname=leadpilot_restore --no-owner --role=leadpilot_owner --exit-on-error leadpilot-YYYY-MM-DD.dump
```
If restoring as a different user, grants must be re-applied: run `prisma migrate deploy` (idempotent on an up-to-date schema) and confirm the grants below.

## Verification (must all pass)
```sql
-- 1. RLS is on for every table with a tenant_id (expect zero rows)
SELECT c.table_name FROM information_schema.columns c
JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace
WHERE c.table_schema='public' AND c.column_name='tenant_id' AND NOT k.relrowsecurity;
-- 2. The app role is not privileged (expect rolsuper=f, rolbypassrls=f)
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='leadpilot_app';
-- 3. Row counts plausible vs. production for: tenants, users, leads, messages, invoices, audit_logs
-- 4. Migration state: SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;  -- expect 0
```
Then, as `leadpilot_app` with no tenant set, `SELECT count(*) FROM leads;` must return **0**. Finally boot the API against it and call `/health/ready`, log in as a test tenant, load the dashboard.

## Drill record
Scripted in `scripts/backup-restore-drill.sh` (logical dump to a scratch database, then structural and data verification). Re-run it after any migration that adds tables, roles or extensions, and at least quarterly. **A PITR restore on RDS has NOT been drilled** (no AWS environment exists yet); that drill is required before launch.

| Field | Value |
|---|---|
| Date / operator | 2026-11-16 / Claude (automated, local) |
| Backup source and size | local compose Postgres 17 (pgvector), database `leadpilot`, 192 MB incl. a 100k-lead load-test tenant; dump 16 MB (custom format) |
| Method | `pg_dump -Fc` then `pg_restore` into a fresh database created by a SUPERUSER with the same extensions pre-created (`vector`, `btree_gist`, `citext`, `pg_trgm`, `pgcrypto`); extension `COMMENT`s skipped (they need extension ownership); restore run as the owner role |
| Measured time to restore + verify (RTO) | dump 1.0 s + restore 2.1 s for this size, verification a few seconds. **Not representative of production size**: scale by data volume |
| Data loss window (RPO) | not applicable to a manual dump (= time since the dump). RDS PITR RPO (about 5 min) is unverified |
| Verification | row counts equal for 12 key tables; 51 tables with RLS and 60 policies; 13 SECURITY DEFINER functions; 2 exclusion constraints; 187 app-role grants; same extensions; invoice counter equal; **as `leadpilot_app`: with a tenant in scope exactly that tenant's 100,040 leads are visible, with no tenant in scope 0** |
| Issues found / follow-ups | (1) restoring as the owner role fails on `CREATE EXTENSION vector` unless a superuser pre-creates extensions: step 1 of the restore procedure above. (2) extension comments need `-L` filtering. (3) the drill must run while the source is quiet, otherwise live writes make before/after counts differ. (4) Redis (queues, rate limits) is not part of the backup: queue state is rebuilt from `outbox_events`/`automation_runs` by the scanners; files in S3 need their own versioning/replication (not drilled) |
