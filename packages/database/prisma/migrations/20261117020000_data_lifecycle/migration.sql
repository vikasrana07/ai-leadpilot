-- Phase 8 / F2: data lifecycle (retention purge, tenant export, tenant deletion).

CREATE TABLE data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  requested_by_user_id uuid,
  status text NOT NULL DEFAULT 'QUEUED',          -- QUEUED | RUNNING | READY | FAILED | EXPIRED
  storage_key text,
  size_bytes bigint,
  error text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  started_at timestamptz(3),
  completed_at timestamptz(3),
  expires_at timestamptz(3)
);
CREATE INDEX data_exports_tenant_id_created_at_idx ON data_exports (tenant_id, created_at DESC);
-- one active export per workspace, enforced by the database
CREATE UNIQUE INDEX data_exports_one_active ON data_exports (tenant_id) WHERE status IN ('QUEUED', 'RUNNING');

CREATE TABLE tenant_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  requested_by_user_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',         -- PENDING | CANCELED
  requested_at timestamptz(3) NOT NULL DEFAULT now(),
  purge_after timestamptz(3) NOT NULL,
  canceled_at timestamptz(3)
);
CREATE INDEX tenant_deletion_requests_tenant_id_idx ON tenant_deletion_requests (tenant_id);
CREATE UNIQUE INDEX tenant_deletion_requests_one_pending ON tenant_deletion_requests (tenant_id) WHERE status = 'PENDING';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_exports', 'tenant_deletion_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO leadpilot_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- retention purge
-- One bounded batch per call. NULL days = keep forever. p_dry only counts. Everything is tenant-checked and runs as the owner, so the
-- application role needs no DELETE grants on webhook payloads, messages or the (append-only) audit log.
CREATE OR REPLACE FUNCTION purge_retention(p_tenant uuid, p_webhook_days int, p_convo_days int, p_audit_days int, p_lead_days int, p_limit int, p_dry boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n jsonb := '{}'::jsonb; c int; convs uuid[]; runs uuid[]; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RETURN NULL; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN p_limit := 1000; END IF;

  IF p_webhook_days IS NOT NULL THEN
    IF p_dry THEN SELECT count(*) INTO c FROM webhook_events WHERE tenant_id = p_tenant AND created_at < now() - make_interval(days => p_webhook_days);
    ELSE
      WITH d AS (SELECT id FROM webhook_events WHERE tenant_id = p_tenant AND created_at < now() - make_interval(days => p_webhook_days) LIMIT p_limit)
      DELETE FROM webhook_events w USING d WHERE w.id = d.id; GET DIAGNOSTICS c = ROW_COUNT;
    END IF;
    n := n || jsonb_build_object('webhook_events', c);
  END IF;

  IF p_convo_days IS NOT NULL THEN
    SELECT COALESCE(array_agg(id), '{}') INTO convs FROM (SELECT id FROM conversations WHERE tenant_id = p_tenant AND status = 'CLOSED' AND closed_at IS NOT NULL AND closed_at < now() - make_interval(days => p_convo_days) LIMIT p_limit) x;
    SELECT count(*) INTO c FROM messages WHERE tenant_id = p_tenant AND conversation_id = ANY(convs);
    n := n || jsonb_build_object('conversations', COALESCE(array_length(convs, 1), 0), 'messages', c);
    IF NOT p_dry AND array_length(convs, 1) > 0 THEN
      SELECT COALESCE(array_agg(id), '{}') INTO runs FROM ai_runs WHERE tenant_id = p_tenant AND conversation_id = ANY(convs);
      DELETE FROM ai_tool_executions WHERE tenant_id = p_tenant AND run_id = ANY(runs);
      DELETE FROM ai_runs WHERE tenant_id = p_tenant AND id = ANY(runs);
      DELETE FROM sla_breaches WHERE tenant_id = p_tenant AND conversation_id = ANY(convs);
      DELETE FROM conversations WHERE tenant_id = p_tenant AND id = ANY(convs); -- cascades messages and notes
    END IF;
  END IF;

  IF p_audit_days IS NOT NULL THEN
    -- records of privacy actions (erasure, exports, purges) are evidence of compliance and are never aged out here
    IF p_dry THEN SELECT count(*) INTO c FROM audit_logs WHERE tenant_id = p_tenant AND action NOT LIKE 'privacy.%' AND created_at < now() - make_interval(days => p_audit_days);
    ELSE
      WITH d AS (SELECT id FROM audit_logs WHERE tenant_id = p_tenant AND action NOT LIKE 'privacy.%' AND created_at < now() - make_interval(days => p_audit_days) LIMIT p_limit)
      DELETE FROM audit_logs a USING d WHERE a.id = d.id; GET DIAGNOSTICS c = ROW_COUNT;
    END IF;
    n := n || jsonb_build_object('audit_logs', c);
  END IF;

  IF p_lead_days IS NOT NULL THEN
    c := 0;
    FOR r IN SELECT id FROM leads WHERE tenant_id = p_tenant AND deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => p_lead_days) ORDER BY deleted_at LIMIT p_limit LOOP
      IF p_dry THEN c := c + 1; ELSE PERFORM erase_lead(p_tenant, r.id); c := c + 1; END IF;
    END LOOP;
    n := n || jsonb_build_object('leads', c);
  END IF;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- tenant purge (end of the cooling-off period)
-- Deletes EVERY row of the workspace from every table that has a tenant_id (discovered at run time, so a new table is covered by
-- construction), then the tenant row and any user account left without a workspace. Retained on purpose: invoices and payments
-- (GST record-keeping; legal confirmation pending) and the platform audit log (content-free).
CREATE OR REPLACE FUNCTION purge_tenant(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  retained text[] := ARRAY['invoices', 'payments', 'platform_audit_logs'];
  done text[] := '{}'; counts jsonb := '{}'::jsonb; t text; c int; pass int; uids uuid[]; users_deleted int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RETURN NULL; END IF;
  SELECT COALESCE(array_agg(user_id), '{}') INTO uids FROM memberships WHERE tenant_id = p_tenant;
  UPDATE tenants SET status = 'DELETED' WHERE id = p_tenant;
  FOR pass IN 1..8 LOOP
    FOR t IN SELECT DISTINCT table_name::text FROM information_schema.columns
             WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> ALL (retained) AND table_name <> ALL (done) LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', t) USING p_tenant;
        GET DIAGNOSTICS c = ROW_COUNT;
        counts := counts || jsonb_build_object(t, c); done := done || t;
      EXCEPTION WHEN foreign_key_violation THEN NULL; -- a parent table must go first; retried on the next pass
      END;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> ALL (retained) AND table_name <> ALL (done)) THEN
    RAISE EXCEPTION 'purge_tenant: could not delete every tenant table';
  END IF;
  DELETE FROM tenants WHERE id = p_tenant;
  DELETE FROM users u WHERE u.id = ANY (uids) AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id);
  GET DIAGNOSTICS users_deleted = ROW_COUNT;
  RETURN jsonb_build_object('tables', counts, 'retained', to_jsonb(retained), 'users_deleted', users_deleted);
END $$;

-- ---------------------------------------------------------------- cross-tenant job queues (ids only)
CREATE OR REPLACE FUNCTION list_pending_exports() RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.tenant_id FROM data_exports e JOIN tenants t ON t.id = e.tenant_id WHERE e.status = 'QUEUED' OR (e.status = 'RUNNING' AND e.started_at < now() - interval '15 minutes') ORDER BY e.created_at LIMIT 20
$$;
CREATE OR REPLACE FUNCTION list_expired_exports() RETURNS TABLE (id uuid, tenant_id uuid, storage_key text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, tenant_id, storage_key FROM data_exports WHERE status = 'READY' AND expires_at < now() LIMIT 50
$$;
CREATE OR REPLACE FUNCTION list_due_tenant_deletions() RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, tenant_id FROM tenant_deletion_requests WHERE status = 'PENDING' AND purge_after <= now() ORDER BY purge_after LIMIT 5
$$;
CREATE OR REPLACE FUNCTION platform_deletion_requests() RETURNS TABLE (id uuid, tenant_id uuid, tenant_name text, tenant_email text, reason text, requested_at timestamptz, purge_after timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.tenant_id, t.name, t.email, r.reason, r.requested_at, r.purge_after FROM tenant_deletion_requests r JOIN tenants t ON t.id = r.tenant_id WHERE r.status = 'PENDING' ORDER BY r.purge_after
$$;

REVOKE ALL ON FUNCTION purge_retention(uuid,int,int,int,int,int,boolean), purge_tenant(uuid), list_pending_exports(), list_expired_exports(), list_due_tenant_deletions(), platform_deletion_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_retention(uuid,int,int,int,int,int,boolean), purge_tenant(uuid), list_pending_exports(), list_expired_exports(), list_due_tenant_deletions(), platform_deletion_requests() TO leadpilot_app;
