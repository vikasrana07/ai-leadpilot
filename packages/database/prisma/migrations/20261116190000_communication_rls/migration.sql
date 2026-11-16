-- Phase 3: RLS + grants for communication tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_credentials','channels','widget_configs','conversations','messages','conversation_notes','consents','whatsapp_templates','webhook_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON integration_credentials, channels, widget_configs, conversations, webhook_events TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates, conversation_notes TO leadpilot_app;
-- Messages are never deleted or rewritten by the app, except for delivery status / error fields (UPDATE needed).
GRANT SELECT, INSERT, UPDATE ON messages TO leadpilot_app;
-- Consent history is append-only.
GRANT SELECT, INSERT ON consents TO leadpilot_app;

-- Public entry points resolve the tenant from an unguessable key BEFORE tenant context exists.
CREATE OR REPLACE FUNCTION find_channel_by_webhook_key(p_key text)
RETURNS TABLE (id uuid, tenant_id uuid, type text, status text, external_id text, config jsonb, credential_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.type::text, c.status::text, c.external_id, c.config, c.credential_id FROM channels c WHERE c.webhook_key = p_key
$$;
REVOKE ALL ON FUNCTION find_channel_by_webhook_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_channel_by_webhook_key(text) TO leadpilot_app;

CREATE OR REPLACE FUNCTION find_widget_by_public_key(p_key text)
RETURNS TABLE (tenant_id uuid, channel_id uuid, enabled boolean, allowed_origins text[], theme jsonb, title text, greeting text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.tenant_id, w.channel_id, w.enabled, w.allowed_origins, w.theme, w.title, w.greeting FROM widget_configs w WHERE w.public_key = p_key
$$;
REVOKE ALL ON FUNCTION find_widget_by_public_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_widget_by_public_key(text) TO leadpilot_app;
