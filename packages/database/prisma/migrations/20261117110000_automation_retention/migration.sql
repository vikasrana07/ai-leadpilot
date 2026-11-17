-- Retention for automation history (ADR-0010 follow-up). Dry runs create a DRY_RUN row per test click and every event creates a run,
-- so without this the tables only grow. The app role still has NO delete rights on automation_runs / automation_versions (versions
-- are immutable at runtime); the purge runs inside this SECURITY DEFINER function, one bounded batch per call, tenant-checked.
--
-- Deleted: terminal runs (SUCCEEDED, FAILED, SKIPPED) older than p_run_days, DRY_RUN rows older than p_dry_run_days, and versions older
-- than p_version_days that are not the automation's current version AND that no remaining run references.
-- Never deleted: QUEUED, RUNNING or WAITING runs; the active version; the version at the automation's current graph_version; a version
-- a run (of any status) still points at. NULL days = keep forever for that category. p_dry only counts.
CREATE OR REPLACE FUNCTION purge_automation_data(p_tenant uuid, p_dry_run_days int, p_run_days int, p_version_days int, p_limit int, p_dry boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n jsonb := '{}'::jsonb; c int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RETURN NULL; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN p_limit := 1000; END IF;

  IF p_dry_run_days IS NOT NULL THEN
    IF p_dry THEN
      SELECT count(*) INTO c FROM automation_runs WHERE tenant_id = p_tenant AND status = 'DRY_RUN' AND created_at < now() - make_interval(days => p_dry_run_days);
    ELSE
      WITH d AS (SELECT id FROM automation_runs WHERE tenant_id = p_tenant AND status = 'DRY_RUN' AND created_at < now() - make_interval(days => p_dry_run_days) ORDER BY created_at LIMIT p_limit)
      DELETE FROM automation_runs r USING d WHERE r.id = d.id; GET DIAGNOSTICS c = ROW_COUNT;
    END IF;
    n := n || jsonb_build_object('automation_dry_runs', c);
  END IF;

  IF p_run_days IS NOT NULL THEN
    IF p_dry THEN
      SELECT count(*) INTO c FROM automation_runs WHERE tenant_id = p_tenant AND status IN ('SUCCEEDED', 'FAILED', 'SKIPPED') AND COALESCE(finished_at, created_at) < now() - make_interval(days => p_run_days);
    ELSE
      WITH d AS (SELECT id FROM automation_runs WHERE tenant_id = p_tenant AND status IN ('SUCCEEDED', 'FAILED', 'SKIPPED') AND COALESCE(finished_at, created_at) < now() - make_interval(days => p_run_days) ORDER BY created_at LIMIT p_limit)
      DELETE FROM automation_runs r USING d WHERE r.id = d.id; GET DIAGNOSTICS c = ROW_COUNT;
    END IF;
    n := n || jsonb_build_object('automation_runs', c);
  END IF;

  IF p_version_days IS NOT NULL THEN
    -- evaluated after the run deletes above, so versions freed by this very call can go in the next batch of the same pass
    IF p_dry THEN
      SELECT count(*) INTO c FROM automation_versions v
      WHERE v.tenant_id = p_tenant AND v.created_at < now() - make_interval(days => p_version_days)
        AND NOT EXISTS (SELECT 1 FROM automations a WHERE a.id = v.automation_id AND (a.active_version_id = v.id OR a.graph_version = v.version))
        AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.version_id = v.id);
    ELSE
      WITH d AS (
        SELECT v.id FROM automation_versions v
        WHERE v.tenant_id = p_tenant AND v.created_at < now() - make_interval(days => p_version_days)
          AND NOT EXISTS (SELECT 1 FROM automations a WHERE a.id = v.automation_id AND (a.active_version_id = v.id OR a.graph_version = v.version))
          AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.version_id = v.id)
        ORDER BY v.created_at LIMIT p_limit)
      DELETE FROM automation_versions v USING d WHERE v.id = d.id; GET DIAGNOSTICS c = ROW_COUNT;
    END IF;
    n := n || jsonb_build_object('automation_versions', c);
  END IF;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION purge_automation_data(uuid, int, int, int, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_automation_data(uuid, int, int, int, int, boolean) TO leadpilot_app;
