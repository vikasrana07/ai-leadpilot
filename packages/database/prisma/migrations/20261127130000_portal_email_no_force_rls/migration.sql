-- find_portal_email_by_key is SECURITY DEFINER and runs as the table owner; with FORCE RLS the owner is also
-- filtered by the tenant_isolation policy and the unauthenticated webhook lookup returns no rows.
-- The app role (leadpilot_app) stays subject to RLS.
ALTER TABLE "portal_email_configs" NO FORCE ROW LEVEL SECURITY;
