-- Alert state for platform monitoring (one row per rule that has ever breached). Platform-owned data with no tenant_id: like
-- platform_audit_logs it is visible only when NO tenant is in scope, so a tenant-context bug can never read or write it.
-- Rows hold rule keys, counters, timestamps and numeric values only: no tenant names, emails or message content.
CREATE TABLE ops_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE,
  severity           integer NOT NULL CHECK (severity BETWEEN 1 AND 3),
  status             text NOT NULL DEFAULT 'resolved' CHECK (status IN ('firing', 'resolved')),
  title              text NOT NULL,
  streak_failing     integer NOT NULL DEFAULT 0,
  streak_ok          integer NOT NULL DEFAULT 0,
  since              timestamptz,
  resolved_at        timestamptz,
  last_notified_at   timestamptz,
  notify_count       integer NOT NULL DEFAULT 0,
  resolve_notify_due boolean NOT NULL DEFAULT false,
  last_value         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_alerts_status_idx ON ops_alerts (status, severity);

ALTER TABLE ops_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only_select ON ops_alerts FOR SELECT TO leadpilot_app USING (app_tenant_id() IS NULL);
CREATE POLICY platform_only_insert ON ops_alerts FOR INSERT TO leadpilot_app WITH CHECK (app_tenant_id() IS NULL);
CREATE POLICY platform_only_update ON ops_alerts FOR UPDATE TO leadpilot_app USING (app_tenant_id() IS NULL) WITH CHECK (app_tenant_id() IS NULL);

-- The app role may read, create and update alert state, never delete it (history of an alert is its row).
GRANT SELECT, INSERT, UPDATE ON ops_alerts TO leadpilot_app;
