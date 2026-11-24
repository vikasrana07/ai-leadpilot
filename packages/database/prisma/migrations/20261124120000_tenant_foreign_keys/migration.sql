-- Audit finding S-09 (phase 1): only 6 of the 66 tenant-scoped tables had a foreign key to tenants, so rows could outlive their workspace
-- (a dev database held ~145k such orphans) and RLS was the only guard. This migration
--   1. deletes rows whose tenant no longer exists (they are unreachable: RLS hides them from every tenant),
--   2. adds tenants(id) foreign keys with ON DELETE CASCADE to every remaining tenant-scoped table, as NOT VALID and then VALIDATE
--      (so the lock taken for the long scan is the light one and writes keep flowing).
-- Deliberately excluded: the tables purge_tenant() retains on purpose after a workspace is deleted (billing records and the platform audit log).
-- leads.source_id is a foreign key (ON DELETE SET NULL) with no index: removing a lead source scanned every lead, which made the orphan
-- clean-up below take many minutes on 100k leads and would make any bulk source delete just as slow.
CREATE INDEX IF NOT EXISTS leads_source_id_idx ON leads (source_id) WHERE source_id IS NOT NULL;

DO $$
DECLARE
  retained text[] := ARRAY['invoices', 'payments', 'platform_audit_logs'];
  t text; n bigint; pass int; pending text[];
BEGIN
  SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO pending
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
    AND c.relname <> 'tenants' AND c.relname <> ALL (retained)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.conrelid = c.oid AND k.confrelid = 'tenants'::regclass AND k.conkey = ARRAY[a.attnum]);

  -- 1. orphans (a child table may reference another orphan table, so retry until a pass deletes nothing new)
  FOR pass IN 1..6 LOOP
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I x WHERE NOT EXISTS (SELECT 1 FROM tenants p WHERE p.id = x.tenant_id)', t);
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN RAISE NOTICE 'S-09: removed % orphan rows from %', n, t; END IF;
      EXCEPTION WHEN foreign_key_violation THEN NULL; -- a dependent table goes first; retried on the next pass
      END;
    END LOOP;
  END LOOP;

  -- 2. constraints
  FOREACH t IN ARRAY pending LOOP
    -- Postgres cannot add a NOT VALID foreign key to a partitioned table (audit_logs): those are added and checked in one step.
    IF (SELECT relkind FROM pg_class WHERE oid = to_regclass(quote_ident(t))) = 'p' THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE', t, t || '_tenant_id_fkey');
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID', t, t || '_tenant_id_fkey');
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, t || '_tenant_id_fkey');
    END IF;
  END LOOP;
END $$;
