-- Phase 8 (F3): public API keys with expiry/usage, idempotency, outbound webhooks, support-access sessions, api_access entitlement.

-- ---------------------------------------------------------------- API keys
ALTER TABLE api_keys ADD COLUMN expires_at timestamptz(3), ADD COLUMN request_count bigint NOT NULL DEFAULT 0;
DROP FUNCTION IF EXISTS find_api_key_by_hash(text);
CREATE FUNCTION find_api_key_by_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, scopes text[], revoked_at timestamptz, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.id, k.tenant_id, k.scopes, k.revoked_at, k.expires_at FROM api_keys k WHERE k.key_hash = p_hash
$$;
REVOKE ALL ON FUNCTION find_api_key_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_api_key_by_hash(text) TO leadpilot_app;

-- ---------------------------------------------------------------- idempotency for POSTs
CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  api_key_id uuid,
  request_hash text NOT NULL,
  status_code int,
  response jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

-- ---------------------------------------------------------------- outbound webhooks
CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  url text NOT NULL,
  description text,
  events text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  disabled_reason text,
  consecutive_failures int NOT NULL DEFAULT 0,
  secret_prefix text NOT NULL,
  secret_ciphertext text NOT NULL,
  secret_wrapped_key text NOT NULL,
  secret_key_id text NOT NULL,
  created_by uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_tenant_idx ON webhook_endpoints (tenant_id);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  test boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | SENDING | SUCCEEDED | FAILED
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(3) NOT NULL DEFAULT now(),
  last_status_code int,
  last_error text,
  last_latency_ms int,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  delivered_at timestamptz(3),
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX webhook_deliveries_tenant_created_idx ON webhook_deliveries (tenant_id, created_at DESC);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status IN ('PENDING', 'SENDING');

-- ---------------------------------------------------------------- support access (read-only impersonation)
CREATE TABLE support_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  admin_name text NOT NULL,
  reason text NOT NULL,
  started_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  ended_at timestamptz(3),
  ip text
);
CREATE INDEX support_access_sessions_tenant_idx ON support_access_sessions (tenant_id, started_at DESC);

-- ---------------------------------------------------------------- RLS + grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['idempotency_keys','webhook_endpoints','webhook_deliveries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys, webhook_endpoints TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO leadpilot_app;
GRANT UPDATE (expires_at, request_count) ON api_keys TO leadpilot_app;

-- Support sessions are platform-owned data (like platform_audit_logs): visible only when NO tenant is in scope. Tenant-side checks go
-- through the two narrow functions below, never through the table.
ALTER TABLE support_access_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only_select ON support_access_sessions FOR SELECT TO leadpilot_app USING (app_tenant_id() IS NULL);
CREATE POLICY platform_only_insert ON support_access_sessions FOR INSERT TO leadpilot_app WITH CHECK (app_tenant_id() IS NULL);
CREATE POLICY platform_only_update ON support_access_sessions FOR UPDATE TO leadpilot_app USING (app_tenant_id() IS NULL) WITH CHECK (app_tenant_id() IS NULL);
GRANT SELECT, INSERT, UPDATE ON support_access_sessions TO leadpilot_app;

-- A support session is valid only while unexpired, not ended, for THAT tenant, and while the tenant has not switched support access off.
CREATE OR REPLACE FUNCTION support_session_active(p_session uuid, p_tenant uuid)
RETURNS TABLE (admin_id uuid, admin_name text, reason text, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.admin_id, s.admin_name, s.reason, s.expires_at FROM support_access_sessions s
  JOIN tenants t ON t.id = s.tenant_id
  WHERE s.id = p_session AND s.tenant_id = p_tenant AND s.ended_at IS NULL AND s.expires_at > now()
    AND t.status = 'ACTIVE' AND COALESCE((t.settings->>'supportAccess')::boolean, true)
$$;
CREATE OR REPLACE FUNCTION support_session_end(p_session uuid, p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE support_access_sessions SET ended_at = now() WHERE id = p_session AND tenant_id = p_tenant AND ended_at IS NULL;
  RETURN FOUND;
END $$;
-- Ends every open session of a tenant (used when an owner switches support access off).
CREATE OR REPLACE FUNCTION support_sessions_end_all(p_tenant uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE support_access_sessions SET ended_at = now() WHERE tenant_id = p_tenant AND ended_at IS NULL; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION support_session_active(uuid, uuid), support_session_end(uuid, uuid), support_sessions_end_all(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_session_active(uuid, uuid), support_session_end(uuid, uuid), support_sessions_end_all(uuid) TO leadpilot_app;

-- Webhook delivery claim (cross-tenant, like claim_outbox_batch): leased for 2 minutes, SKIP LOCKED so any number of workers can run.
CREATE OR REPLACE FUNCTION claim_webhook_deliveries(p_limit int) RETURNS SETOF webhook_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE webhook_deliveries d SET status = 'SENDING', attempts = d.attempts + 1, next_attempt_at = now() + interval '2 minutes'
  WHERE d.id IN (SELECT id FROM webhook_deliveries WHERE status IN ('PENDING','SENDING') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING d.*;
END $$;
REVOKE ALL ON FUNCTION claim_webhook_deliveries(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_webhook_deliveries(int) TO leadpilot_app;

-- ---------------------------------------------------------------- api_access entitlement (Growth + Premium + internal on, Starter off)
INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES
  ('internal','api_access',true,NULL), ('starter','api_access',false,NULL), ('growth','api_access',true,NULL), ('premium','api_access',true,NULL)
ON CONFLICT DO NOTHING;
