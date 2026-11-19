-- Migration: Monthly PostgreSQL Table Partitioning for AuditLog (created_at)

-- 1. Create the partitioned audit_logs table
CREATE TABLE IF NOT EXISTS "audit_logs_partitioned" (
    "id" UUID DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "metadata" JSONB DEFAULT '{}'::jsonb NOT NULL,
    "request_id" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT "audit_logs_partitioned_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

-- 2. Create monthly partitions for 2026
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m01" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m02" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m03" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m04" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m05" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m06" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m07" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m08" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m09" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m10" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m11" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2026m12" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- 3. Create monthly partitions for 2027
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m01" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m02" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m03" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m04" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-04-01 00:00:00+00') TO ('2027-05-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m05" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-05-01 00:00:00+00') TO ('2027-06-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m06" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-06-01 00:00:00+00') TO ('2027-07-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m07" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-07-01 00:00:00+00') TO ('2027-08-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m08" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-08-01 00:00:00+00') TO ('2027-09-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m09" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-09-01 00:00:00+00') TO ('2027-10-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m10" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-10-01 00:00:00+00') TO ('2027-11-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m11" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-11-01 00:00:00+00') TO ('2027-12-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS "audit_logs_y2027m12" PARTITION OF "audit_logs_partitioned"
    FOR VALUES FROM ('2027-12-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');

-- 4. Create catch-all default partition
CREATE TABLE IF NOT EXISTS "audit_logs_default" PARTITION OF "audit_logs_partitioned" DEFAULT;

-- 5. Copy data from existing table if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    INSERT INTO "audit_logs_partitioned" ("id", "tenant_id", "actor_user_id", "action", "resource_type", "resource_id", "metadata", "request_id", "ip", "created_at")
    SELECT "id", "tenant_id", "actor_user_id", "action", "resource_type", "resource_id", "metadata", "request_id", "ip", "created_at"
    FROM "audit_logs";
    DROP TABLE "audit_logs";
  END IF;
END $$;

-- 6. Rename partitioned table to audit_logs
ALTER TABLE "audit_logs_partitioned" RENAME TO "audit_logs";

-- 7. Indexes (automatically propagated to all partitions)
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_action_idx" ON "audit_logs"("tenant_id", "action");

-- 8. Row Level Security & permissions
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON "audit_logs" TO leadpilot_app;

DROP POLICY IF EXISTS audit_select ON "audit_logs";
CREATE POLICY audit_select ON "audit_logs" FOR SELECT TO leadpilot_app
  USING (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS audit_insert ON "audit_logs";
CREATE POLICY audit_insert ON "audit_logs" FOR INSERT TO leadpilot_app
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant_id());

-- 9. Partition maintenance helper functions
CREATE OR REPLACE FUNCTION create_audit_log_partition(p_year int, p_month int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start date;
  v_end date;
  v_part_name text;
  v_sql text;
BEGIN
  IF p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'Invalid month %: must be between 1 and 12', p_month;
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := v_start + INTERVAL '1 month';
  v_part_name := format('audit_logs_y%sm%s', to_char(p_year, 'FM0000'), to_char(p_month, 'FM00'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = v_part_name AND n.nspname = 'public'
  ) THEN
    v_sql := format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "audit_logs" FOR VALUES FROM (%L) TO (%L)',
      v_part_name,
      v_start::timestamptz,
      v_end::timestamptz
    );
    EXECUTE v_sql;
    RETURN v_part_name;
  END IF;

  RETURN v_part_name || ' already exists';
END;
$$;

CREATE OR REPLACE FUNCTION drop_audit_log_partition(p_year int, p_month int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_part_name text;
BEGIN
  v_part_name := format('audit_logs_y%sm%s', to_char(p_year, 'FM0000'), to_char(p_month, 'FM00'));
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = v_part_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format('DROP TABLE IF EXISTS %I', v_part_name);
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- Global purge by retention days: instant partition drops for any fully-expired months
CREATE OR REPLACE FUNCTION purge_old_audit_log_partitions(p_retention_days int)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff date;
  v_rec record;
  v_dropped text[] := ARRAY[]::text[];
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RETURN v_dropped;
  END IF;

  v_cutoff := (now() - make_interval(days => p_retention_days))::date;

  FOR v_rec IN
    SELECT c.relname AS table_name,
           substring(c.relname from 'audit_logs_y([0-9]{4})')::int AS yr,
           substring(c.relname from 'audit_logs_y[0-9]{4}m([0-9]{2})')::int AS mo
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname ~ '^audit_logs_y[0-9]{4}m[0-9]{2}$'
  LOOP
    IF (make_date(v_rec.yr, v_rec.mo, 1) + INTERVAL '1 month')::date <= v_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', v_rec.table_name);
      v_dropped := array_append(v_dropped, v_rec.table_name);
    END IF;
  END LOOP;

  RETURN v_dropped;
END;
$$;
