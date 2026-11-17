-- Automation graph (ADR-0010): optional graph on the automation, immutable versions, runs pinned to a version, durable waits.
ALTER TABLE automations
  ADD COLUMN graph jsonb,
  ADD COLUMN graph_version integer NOT NULL DEFAULT 1,
  ADD COLUMN active_version_id uuid;

-- One row per saved definition. Immutable: the app role can read and insert, never update or delete (versions go with their automation).
CREATE TABLE automation_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  /** 'linear' = lifted from the legacy trigger/conditions/actions columns (conditions are gated before the run); 'graph' = authored as a graph */
  source        text NOT NULL DEFAULT 'graph' CHECK (source IN ('linear', 'graph')),
  graph         jsonb NOT NULL,
  cooldown_minutes integer NOT NULL DEFAULT 60,
  created_by    uuid,
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (automation_id, version)
);
CREATE INDEX automation_versions_tenant_automation_idx ON automation_versions (tenant_id, automation_id);

ALTER TABLE automation_runs
  ADD COLUMN version_id uuid REFERENCES automation_versions(id) ON DELETE SET NULL,
  ADD COLUMN resume_at timestamptz(3),
  ADD COLUMN waiting_node text;
CREATE INDEX automation_runs_status_resume_idx ON automation_runs (status, resume_at);
CREATE INDEX automation_runs_lead_waiting_idx ON automation_runs (tenant_id, lead_id, status);

ALTER TABLE automation_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_versions FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT ON automation_versions TO leadpilot_app;
