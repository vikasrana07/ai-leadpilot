-- Lead-facing customer portal (ADR 0013): a business's own customer signs in with a one-time code and sees / changes THEIR appointments.
-- Three tenant tables (all under row-level security), one lookup function and the `lead_portal` plan feature.

-- Per-workspace portal settings. `public_key` goes in the portal address (/p/<key>): unguessable, rotatable, and it only says WHICH business;
-- it grants nothing without a verified one-time code.
CREATE TABLE portal_configs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL UNIQUE,
  public_key           text NOT NULL UNIQUE,
  enabled              boolean NOT NULL DEFAULT false,
  allow_confirm        boolean NOT NULL DEFAULT true,
  allow_cancel         boolean NOT NULL DEFAULT true,
  allow_reschedule     boolean NOT NULL DEFAULT true,
  cancel_cutoff_hours  int NOT NULL DEFAULT 4 CHECK (cancel_cutoff_hours BETWEEN 0 AND 168),
  created_at           timestamptz(3) NOT NULL DEFAULT now(),
  updated_at           timestamptz(3) NOT NULL DEFAULT now()
);

-- One-time codes. Only an HMAC of the code is stored; `identity_hash` is a hash of the phone/email the person typed (never the value), used to
-- throttle and lock out per identity. `lead_id` is the lead the code was issued for. A code is single use, expires, and counts attempts.
CREATE TABLE portal_login_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  lead_id       uuid NOT NULL,
  identity_hash text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  code_hash     text NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  expires_at    timestamptz(3) NOT NULL,
  consumed_at   timestamptz(3),
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX portal_login_codes_identity_idx ON portal_login_codes (tenant_id, identity_hash, created_at DESC);

-- Server-side sessions, so a portal session can be revoked (logout, the lead was erased or merged, the portal was switched off or its key rotated).
CREATE TABLE portal_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  lead_id      uuid NOT NULL,
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX portal_sessions_lead_idx ON portal_sessions (tenant_id, lead_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_configs', 'portal_login_codes', 'portal_sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON portal_configs TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_login_codes, portal_sessions TO leadpilot_app;

-- Which business does this portal address belong to? Runs before any workspace context exists. Returns only what a sign-in page needs.
CREATE OR REPLACE FUNCTION find_portal_by_public_key(p_key text)
RETURNS TABLE (tenant_id uuid, enabled boolean, allow_confirm boolean, allow_cancel boolean, allow_reschedule boolean, cancel_cutoff_hours int, business_name text, logo_url text, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, c.enabled, c.allow_confirm, c.allow_cancel, c.allow_reschedule, c.cancel_cutoff_hours, t.name, t.logo_url, t.timezone
  FROM portal_configs c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.public_key = p_key AND t.status = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION find_portal_by_public_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_portal_by_public_key(text) TO leadpilot_app;

-- Plan feature: on for Growth, Premium and Internal, off for Starter (editable in the platform console).
INSERT INTO plan_entitlements (plan_key, key, enabled, "limit") VALUES
  ('internal', 'lead_portal', true, NULL), ('starter', 'lead_portal', false, NULL), ('growth', 'lead_portal', true, NULL), ('premium', 'lead_portal', true, NULL)
ON CONFLICT DO NOTHING;
