-- WhatsApp Embedded Signup (ADR-0012): one platform Meta app delivers every tenant's webhooks to ONE URL, so an incoming message is routed
-- to a workspace by its phone_number_id. That is only safe if a phone number can belong to a single workspace. The old unique key was
-- per tenant (tenant_id, type, external_id); this adds a database-level guarantee across tenants (row-level security cannot hide a
-- duplicate from a unique index). Disabled channels keep their number reserved on purpose: re-enabling must never collide.

-- Refuse to run if data already breaks the rule, and say how many numbers (never which workspace or number).
DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (SELECT external_id FROM channels WHERE type = 'WHATSAPP' AND external_id IS NOT NULL GROUP BY external_id HAVING count(*) > 1) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'whatsapp_phone_global_unique: % WhatsApp phone number(s) are connected in more than one workspace; resolve them (disable and delete the extra channels) before applying this migration', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS channels_whatsapp_external_id_key ON channels (external_id) WHERE type = 'WHATSAPP' AND external_id IS NOT NULL;

-- Routes a platform webhook entry to its channel by phone number id, before any tenant context exists. Returns the minimum needed:
-- no config (so no verify token), no credential id, no name.
CREATE OR REPLACE FUNCTION find_channel_by_phone_number_id(p_phone text)
RETURNS TABLE (id uuid, tenant_id uuid, status text, mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.status::text, COALESCE(c.config ->> 'mode', 'manual')
  FROM channels c WHERE c.type = 'WHATSAPP' AND c.external_id = p_phone
$$;
REVOKE ALL ON FUNCTION find_channel_by_phone_number_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_channel_by_phone_number_id(text) TO leadpilot_app;
