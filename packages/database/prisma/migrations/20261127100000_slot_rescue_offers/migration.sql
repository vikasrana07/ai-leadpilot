DO $$ BEGIN
  CREATE TYPE "SlotRescueStatus" AS ENUM ('OPEN', 'CLAIMED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "slot_rescue_offers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "source_appointment_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "location" TEXT,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "SlotRescueStatus" NOT NULL DEFAULT 'OPEN',
  "claim_token" TEXT NOT NULL,
  "offered_lead_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "claimed_lead_id" UUID,
  "claimed_appointment_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "slot_rescue_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "slot_rescue_offers_claim_token_key" ON "slot_rescue_offers" ("claim_token");
CREATE INDEX IF NOT EXISTS "slot_rescue_offers_tenant_id_created_at_idx" ON "slot_rescue_offers" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "slot_rescue_offers_tenant_id_status_expires_at_idx" ON "slot_rescue_offers" ("tenant_id", "status", "expires_at");

ALTER TABLE "slot_rescue_offers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slot_rescue_offers" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "slot_rescue_offers";
CREATE POLICY "tenant_isolation" ON "slot_rescue_offers"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "slot_rescue_offers" TO leadpilot_app;
  END IF;
END $$;

-- Public token lookup (SECURITY DEFINER): returns only safe offer metadata for /p/claim/:token
CREATE OR REPLACE FUNCTION find_slot_rescue_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  title text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  offered_lead_ids uuid[],
  expires_at timestamptz,
  business_name text,
  timezone text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.tenant_id,
    o.title,
    o.location,
    o.starts_at,
    o.ends_at,
    o.status::text,
    o.offered_lead_ids,
    o.expires_at,
    t.name AS business_name,
    t.timezone
  FROM slot_rescue_offers o
  JOIN tenants t ON t.id = o.tenant_id
  WHERE o.claim_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION find_slot_rescue_by_token(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT EXECUTE ON FUNCTION find_slot_rescue_by_token(text) TO leadpilot_app;
  END IF;
END $$;
