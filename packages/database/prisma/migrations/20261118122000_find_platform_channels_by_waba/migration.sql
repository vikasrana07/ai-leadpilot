-- Meta's account notices (a business removed LeadPilot, a WABA was disconnected) name a WhatsApp Business Account, not a phone number.
-- Routes such a notice to the Facebook-connected channels of that account before any workspace context exists. Ids and status only.
CREATE OR REPLACE FUNCTION find_platform_channels_by_waba(p_waba text)
RETURNS TABLE (id uuid, tenant_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.status::text FROM channels c
  WHERE c.type = 'WHATSAPP' AND c.config ->> 'mode' = 'platform' AND c.config ->> 'wabaId' = p_waba
$$;
REVOKE ALL ON FUNCTION find_platform_channels_by_waba(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_platform_channels_by_waba(text) TO leadpilot_app;
