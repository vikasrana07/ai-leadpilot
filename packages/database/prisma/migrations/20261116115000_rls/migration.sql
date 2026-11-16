-- Row-Level Security + least-privilege grants for the runtime role `leadpilot_app`.
-- Tenant context is set per transaction: SELECT set_config('app.tenant_id', '<uuid>', true).
-- `leadpilot_app` is neither superuser nor table owner, so policies always apply to it.
-- Tables are NOT `FORCE`d: the owner role runs migrations and SECURITY DEFINER helpers only.

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO leadpilot_app;
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_user_id() TO leadpilot_app;

-- ---------- global tables (no tenant_id; accessed only by the auth service) ----------
GRANT SELECT, INSERT, UPDATE ON users, email_verification_tokens, password_reset_tokens TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO leadpilot_app;
GRANT SELECT ON permissions TO leadpilot_app;

-- ---------- tenants ----------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenants TO leadpilot_app;
CREATE POLICY tenants_select ON tenants FOR SELECT TO leadpilot_app
  USING (id = app_tenant_id()
         OR EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app_user_id()));
CREATE POLICY tenants_insert ON tenants FOR INSERT TO leadpilot_app WITH CHECK (id = app_tenant_id());
CREATE POLICY tenants_update ON tenants FOR UPDATE TO leadpilot_app
  USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

-- ---------- memberships (readable across the user's own tenants for the workspace switcher; writes tenant-only) ----------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO leadpilot_app;
CREATE POLICY memberships_select ON memberships FOR SELECT TO leadpilot_app
  USING (tenant_id = app_tenant_id() OR user_id = app_user_id());
CREATE POLICY memberships_insert ON memberships FOR INSERT TO leadpilot_app WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_update ON memberships FOR UPDATE TO leadpilot_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_delete ON memberships FOR DELETE TO leadpilot_app USING (tenant_id = app_tenant_id());

-- ---------- roles ----------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON roles TO leadpilot_app;
CREATE POLICY roles_select ON roles FOR SELECT TO leadpilot_app
  USING (tenant_id = app_tenant_id()
         OR EXISTS (SELECT 1 FROM memberships m WHERE m.role_id = roles.id AND m.user_id = app_user_id()));
CREATE POLICY roles_insert ON roles FOR INSERT TO leadpilot_app WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY roles_update ON roles FOR UPDATE TO leadpilot_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

-- ---------- plain tenant-scoped tables ----------
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO leadpilot_app;
CREATE POLICY tenant_isolation ON role_permissions FOR ALL TO leadpilot_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON invitations TO leadpilot_app;
CREATE POLICY tenant_isolation ON invitations FOR ALL TO leadpilot_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON outbox_events TO leadpilot_app;
CREATE POLICY tenant_isolation ON outbox_events FOR ALL TO leadpilot_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

-- ---------- audit logs: append-only (no UPDATE/DELETE grant at all) ----------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON audit_logs TO leadpilot_app;
CREATE POLICY audit_select ON audit_logs FOR SELECT TO leadpilot_app USING (tenant_id = app_tenant_id());
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO leadpilot_app
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant_id());

-- ---------- invitation lookup by token before tenant context is known ----------
-- Returns at most one row, by exact hash of a 256-bit secret. Runs as owner (RLS not forced).
CREATE OR REPLACE FUNCTION find_invitation_by_token_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, email citext, role_id uuid, expires_at timestamptz,
               accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, i.email, i.role_id, i.expires_at, i.accepted_at, i.revoked_at
  FROM invitations i WHERE i.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION find_invitation_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_invitation_by_token_hash(text) TO leadpilot_app;
