-- Meta's deauthorize and data-deletion callbacks (WhatsApp Embedded Signup, ADR 0012). Platform-owned records with no tenant_id: like ops_alerts and
-- platform_audit_logs they are visible only when NO tenant is in scope. A request holds a SHA-256 hash of Facebook's user id (never the id itself),
-- a public confirmation code (the person can look up its status), and timestamps. LeadPilot stores no Facebook profile data, so the status text says so.
CREATE TABLE meta_data_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('deauthorize', 'data_deletion')),
  confirmation_code text NOT NULL UNIQUE,
  fb_user_hash      text NOT NULL,
  status            text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'completed')),
  note              text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX meta_data_requests_user_idx ON meta_data_requests (fb_user_hash, kind, received_at DESC);
ALTER TABLE meta_data_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only_select ON meta_data_requests FOR SELECT TO leadpilot_app USING (app_tenant_id() IS NULL);
CREATE POLICY platform_only_insert ON meta_data_requests FOR INSERT TO leadpilot_app WITH CHECK (app_tenant_id() IS NULL);
CREATE POLICY platform_only_update ON meta_data_requests FOR UPDATE TO leadpilot_app USING (app_tenant_id() IS NULL) WITH CHECK (app_tenant_id() IS NULL);
-- Requests are never deleted by the app (the record of having received one is the point).
GRANT SELECT, INSERT, UPDATE ON meta_data_requests TO leadpilot_app;
