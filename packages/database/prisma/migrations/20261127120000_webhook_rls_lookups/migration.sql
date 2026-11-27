-- Allow SECURITY DEFINER lookup find_slot_rescue_by_token to read across tenants
ALTER TABLE "slot_rescue_offers" NO FORCE ROW LEVEL SECURITY;

-- Public webhook lookup for Portal Email configs (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION find_portal_email_by_key(p_key text)
RETURNS TABLE (id uuid, tenant_id uuid, webhook_key text, enabled boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.tenant_id, c.webhook_key, c.enabled
  FROM portal_email_configs c
  WHERE c.webhook_key = p_key
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION find_portal_email_by_key(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT EXECUTE ON FUNCTION find_portal_email_by_key(text) TO leadpilot_app;
  END IF;
END $$;
