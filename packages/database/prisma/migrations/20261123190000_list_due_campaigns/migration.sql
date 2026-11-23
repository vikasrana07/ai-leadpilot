-- Cross-tenant sweep for due scheduled broadcast campaigns.
-- The runtime role is bound by RLS (tenant_id = app_tenant_id()), so a query with no tenant context sees zero rows. Like
-- list_active_tenant_ids() and claim_outbox_batch(), the worker sweep goes through a SECURITY DEFINER function that returns ids only;
-- each campaign is then launched inside its own tenant transaction.
CREATE OR REPLACE FUNCTION list_due_campaigns(p_limit int DEFAULT 20) RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id
    FROM broadcast_campaigns c
    JOIN tenants t ON t.id = c.tenant_id AND t.status = 'ACTIVE'
   WHERE c.status = 'SCHEDULED' AND c.scheduled_at <= now()
   ORDER BY c.scheduled_at
   LIMIT GREATEST(p_limit, 1)
$$;

REVOKE ALL ON FUNCTION list_due_campaigns(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_due_campaigns(int) TO leadpilot_app;
