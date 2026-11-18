-- Daily connection health check (WhatsApp Embedded Signup): lists the Facebook-connected channels of every workspace so the background
-- job can test each token. Ids and status only: no config, no names, no credentials. SECURITY DEFINER because the job runs before any
-- workspace context exists; only the app role may execute it.
CREATE OR REPLACE FUNCTION list_platform_channels_for_health()
RETURNS TABLE (id uuid, tenant_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.status::text
  FROM channels c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.type = 'WHATSAPP' AND c.config ->> 'mode' = 'platform' AND c.status IN ('ACTIVE', 'ERROR', 'NEEDS_RECONNECT') AND t.status = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION list_platform_channels_for_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_platform_channels_for_health() TO leadpilot_app;
