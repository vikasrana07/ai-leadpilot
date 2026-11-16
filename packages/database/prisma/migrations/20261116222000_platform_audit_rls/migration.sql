-- platform_audit_logs carries a tenant_id for filtering, but it is platform-owned data. Visible only when NO tenant is in scope
-- (platform console code), invisible inside any tenant-scoped transaction: a tenant-context bug can never read or write it.
ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only_select ON platform_audit_logs FOR SELECT TO leadpilot_app USING (app_tenant_id() IS NULL);
CREATE POLICY platform_only_insert ON platform_audit_logs FOR INSERT TO leadpilot_app WITH CHECK (app_tenant_id() IS NULL);
