-- Phase 5: double-booking guarantees, RLS, grants, and cross-tenant job helpers.

-- ---------------------------------------------------------------- integrity
ALTER TABLE availability_rules ADD CONSTRAINT availability_rules_valid
  CHECK (day_of_week BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);
ALTER TABLE availability_exceptions ADD CONSTRAINT availability_exceptions_valid
  CHECK ((start_minute IS NULL) = (end_minute IS NULL) AND (start_minute IS NULL OR (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute)));
ALTER TABLE appointments ADD CONSTRAINT appointments_valid_range
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '8 hours');

-- The database, not application code, is the final arbiter of "no double booking": two ACTIVE appointments for the same agent
-- (or the same lead) can never overlap, however many requests race. Half-open ranges: back-to-back bookings are allowed.
ALTER TABLE appointments ADD CONSTRAINT appointments_agent_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, membership_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'));
ALTER TABLE appointments ADD CONSTRAINT appointments_lead_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, lead_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'));

-- ---------------------------------------------------------------- RLS + grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['availability_rules','availability_exceptions','appointments','appointment_events','automations','automation_runs','tasks','notifications','notification_preferences','sla_breaches','event_marks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON availability_rules, availability_exceptions, automations, notification_preferences, notifications TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE ON appointments, automation_runs, tasks, sla_breaches TO leadpilot_app;
GRANT SELECT, INSERT ON appointment_events, event_marks TO leadpilot_app;

-- ---------------------------------------------------------------- cross-tenant helpers for background jobs
-- Runs as the schema owner (RLS is not forced on the owner). They expose ONLY what the job runner needs.
CREATE OR REPLACE FUNCTION claim_outbox_batch(p_limit int) RETURNS SETOF outbox_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Rows are leased for 2 minutes: if a relay dies mid-batch, the lease expires and another relay re-claims them.
  RETURN QUERY
  UPDATE outbox_events o SET status = 'processing', attempts = o.attempts + 1, available_at = now() + interval '2 minutes'
  WHERE o.id IN (
    SELECT id FROM outbox_events
    WHERE status IN ('pending', 'processing') AND available_at <= now()
    ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION complete_outbox(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE outbox_events SET status = 'processed', processed_at = now() WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION fail_outbox(p_id uuid, p_retry_seconds int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE outbox_events SET status = CASE WHEN attempts >= 10 THEN 'failed' ELSE 'pending' END, available_at = now() + make_interval(secs => p_retry_seconds) WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION list_active_tenant_ids() RETURNS TABLE (id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id FROM tenants t WHERE t.status = 'ACTIVE'
$$;

REVOKE ALL ON FUNCTION claim_outbox_batch(int), complete_outbox(uuid), fail_outbox(uuid, int), list_active_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbox_batch(int), complete_outbox(uuid), fail_outbox(uuid, int), list_active_tenant_ids() TO leadpilot_app;
