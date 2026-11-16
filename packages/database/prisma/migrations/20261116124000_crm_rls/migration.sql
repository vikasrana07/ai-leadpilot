-- Phase 2: RLS + least-privilege grants for CRM tables, search indexes, API-key lookup.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pipeline_stages','lost_reasons','lead_sources','custom_field_definitions','leads','tags','lead_tags',
    'lead_notes','lead_activities','stage_transitions','properties','api_keys'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_stages, lost_reasons, custom_field_definitions, tags, lead_tags, lead_notes TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE ON lead_sources, leads, properties, api_keys TO leadpilot_app;
-- Append-only history: no UPDATE / DELETE for the app role.
GRANT SELECT, INSERT ON lead_activities, stage_transitions TO leadpilot_app;

-- Fuzzy search (ILIKE '%term%') on the main lookup columns.
CREATE INDEX leads_name_trgm ON leads USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX leads_email_trgm ON leads USING gin (email gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX leads_phone_trgm ON leads USING gin (phone gin_trgm_ops) WHERE deleted_at IS NULL;

-- API key lookup before tenant context is known (hash of a 256-bit secret).
CREATE OR REPLACE FUNCTION find_api_key_by_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, scopes text[], revoked_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.id, k.tenant_id, k.scopes, k.revoked_at FROM api_keys k WHERE k.key_hash = p_hash
$$;
REVOKE ALL ON FUNCTION find_api_key_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_api_key_by_hash(text) TO leadpilot_app;
