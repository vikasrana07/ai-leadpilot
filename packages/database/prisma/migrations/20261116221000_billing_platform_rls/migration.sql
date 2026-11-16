-- Phase 6: RLS, grants, seed plans, and the narrow cross-tenant functions used by billing webhooks and the platform console.

-- ---------------------------------------------------------------- integrity
ALTER TABLE plans ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE plans ADD CONSTRAINT plans_valid CHECK (price_minor >= 0 AND trial_days BETWEEN 0 AND 90 AND key ~ '^[a-z][a-z0-9_]{1,31}$');
ALTER TABLE plan_entitlements ADD CONSTRAINT plan_entitlements_valid CHECK ("limit" IS NULL OR "limit" >= 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts CHECK (taxable_minor >= 0 AND cgst_minor >= 0 AND sgst_minor >= 0 AND igst_minor >= 0 AND total_minor = taxable_minor + cgst_minor + sgst_minor + igst_minor);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_key) REFERENCES plans(key);

-- ---------------------------------------------------------------- RLS (tenant tables)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','billing_profiles','invoices','payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON subscriptions, billing_profiles, payments TO leadpilot_app;
GRANT SELECT, INSERT ON invoices TO leadpilot_app;                       -- invoices are immutable once issued
GRANT SELECT, INSERT, UPDATE, DELETE ON plans, plan_entitlements TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE ON billing_events TO leadpilot_app;
GRANT SELECT, UPDATE ON platform_admins TO leadpilot_app;  -- admins are created out-of-band (owner role), never by the app
GRANT SELECT, INSERT ON platform_audit_logs TO leadpilot_app;  -- append-only

-- ---------------------------------------------------------------- seed plans (editable by platform admins)
INSERT INTO plans (key, name, description, price_minor, trial_days, is_public, sort_order) VALUES
  ('internal', 'Internal', 'Unmetered plan for self-hosted and internal workspaces', 0, 0, false, 0),
  ('starter',  'Starter',  'For a small team getting started with WhatsApp lead capture', 499900, 14, true, 10),
  ('growth',   'Growth',   'For growing sales teams that need automation and exports', 999900, 14, true, 20),
  ('premium',  'Premium',  'For large teams with high message and AI volume', 1499900, 14, true, 30);

INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES
  ('internal','seats',true,NULL),('internal','ai_tokens_monthly',true,NULL),('internal','whatsapp_messages_monthly',true,NULL),('internal','active_automations',true,NULL),('internal','knowledge_mb',true,NULL),
  ('internal','ai_assistant',true,NULL),('internal','automations',true,NULL),('internal','web_widget',true,NULL),('internal','csv_export',true,NULL),
  ('starter','seats',true,3),('starter','ai_tokens_monthly',true,1000000),('starter','whatsapp_messages_monthly',true,3000),('starter','active_automations',true,3),('starter','knowledge_mb',true,100),
  ('starter','ai_assistant',true,NULL),('starter','automations',true,NULL),('starter','web_widget',true,NULL),('starter','csv_export',false,NULL),
  ('growth','seats',true,10),('growth','ai_tokens_monthly',true,3000000),('growth','whatsapp_messages_monthly',true,10000),('growth','active_automations',true,8),('growth','knowledge_mb',true,500),
  ('growth','ai_assistant',true,NULL),('growth','automations',true,NULL),('growth','web_widget',true,NULL),('growth','csv_export',true,NULL),
  ('premium','seats',true,30),('premium','ai_tokens_monthly',true,8000000),('premium','whatsapp_messages_monthly',true,30000),('premium','active_automations',true,NULL),('premium','knowledge_mb',true,2000),
  ('premium','ai_assistant',true,NULL),('premium','automations',true,NULL),('premium','web_widget',true,NULL),('premium','csv_export',true,NULL);

-- ---------------------------------------------------------------- cross-tenant functions (schema owner; expose only what is needed)
-- Gap-free invoice numbers per financial year. Called inside the invoice transaction, so a rollback also rolls the counter back.
CREATE OR REPLACE FUNCTION next_invoice_number(p_fy text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  INSERT INTO invoice_counters (financial_year, last) VALUES (p_fy, 1)
  ON CONFLICT (financial_year) DO UPDATE SET last = invoice_counters.last + 1
  RETURNING last INTO n;
  RETURN 'LP/' || p_fy || '/' || lpad(n::text, 6, '0');
END $$;

-- Webhooks arrive without a tenant: resolve it from the provider's subscription id.
CREATE OR REPLACE FUNCTION billing_tenant_for_subscription(p_provider_subscription_id text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM subscriptions WHERE provider_subscription_id = p_provider_subscription_id
$$;

CREATE OR REPLACE FUNCTION platform_tenant_overview(p_search text, p_status text, p_plan text, p_limit int, p_offset int)
RETURNS TABLE (id uuid, name text, email text, plan_key text, status text, created_at timestamptz, seats bigint, leads bigint, sub_status text, trial_ends_at timestamptz, current_period_end timestamptz, price_minor int, provider text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.name, t.email, t.plan_key, t.status::text, t.created_at,
    (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'ACTIVE'),
    (SELECT count(*) FROM leads l WHERE l.tenant_id = t.id AND l.deleted_at IS NULL),
    s.status::text, s.trial_ends_at, s.current_period_end, p.price_minor, s.provider
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id
  LEFT JOIN plans p ON p.key = t.plan_key
  WHERE (p_search IS NULL OR t.name ILIKE '%' || p_search || '%' OR t.email ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR t.status::text = p_status)
    AND (p_plan IS NULL OR t.plan_key = p_plan)
  ORDER BY t.created_at DESC LIMIT least(p_limit, 200) OFFSET greatest(p_offset, 0)
$$;

CREATE OR REPLACE FUNCTION platform_metrics() RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT json_build_object(
    'tenants_total', (SELECT count(*) FROM tenants WHERE status <> 'DELETED'),
    'tenants_suspended', (SELECT count(*) FROM tenants WHERE status = 'SUSPENDED'),
    'tenants_new_30d', (SELECT count(*) FROM tenants WHERE created_at > now() - interval '30 days'),
    'subs_trialing', (SELECT count(*) FROM subscriptions WHERE status = 'TRIALING'),
    'subs_active', (SELECT count(*) FROM subscriptions WHERE status = 'ACTIVE' AND provider NOT IN ('none')),
    'subs_past_due', (SELECT count(*) FROM subscriptions WHERE status = 'PAST_DUE'),
    'subs_expired', (SELECT count(*) FROM subscriptions WHERE status IN ('EXPIRED','CANCELED')),
    'mrr_minor', COALESCE((SELECT sum(p.price_minor) FROM subscriptions s JOIN plans p ON p.key = s.plan_key WHERE s.status IN ('ACTIVE','PAST_DUE') AND s.provider NOT IN ('none','manual')), 0),
    'comped', (SELECT count(*) FROM subscriptions WHERE provider = 'manual' AND status IN ('ACTIVE','TRIALING')),
    'by_plan', COALESCE((SELECT json_object_agg(plan_key, c) FROM (SELECT plan_key, count(*) c FROM tenants WHERE status <> 'DELETED' GROUP BY plan_key) x), '{}'::json),
    'ai_tokens_month', COALESCE((SELECT sum(input_tokens + output_tokens) FROM ai_runs WHERE created_at >= date_trunc('month', now())), 0)
  )
$$;

CREATE OR REPLACE FUNCTION platform_set_tenant_status(p_tenant uuid, p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE tenants SET status = p_status::"TenantStatus", updated_at = now() WHERE id = p_tenant AND status <> 'DELETED';
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION next_invoice_number(text), billing_tenant_for_subscription(text), platform_tenant_overview(text,text,text,int,int), platform_metrics(), platform_set_tenant_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_invoice_number(text), billing_tenant_for_subscription(text), platform_tenant_overview(text,text,text,int,int), platform_metrics(), platform_set_tenant_status(uuid,text) TO leadpilot_app;
