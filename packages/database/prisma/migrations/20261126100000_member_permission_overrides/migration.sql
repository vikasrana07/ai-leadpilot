DO $$ BEGIN
  CREATE TYPE "PermissionOverrideEffect" AS ENUM ('GRANT', 'REVOKE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "memberships_tenant_id_id_key" ON "memberships" ("tenant_id", "id");

CREATE TABLE IF NOT EXISTS "member_permission_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "permission_key" TEXT NOT NULL,
  "effect" "PermissionOverrideEffect" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "member_permission_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "member_permission_overrides_tenant_membership_fkey"
    FOREIGN KEY ("tenant_id", "membership_id")
    REFERENCES "memberships" ("tenant_id", "id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_permission_overrides_membership_id_permission_key_key"
  ON "member_permission_overrides" ("membership_id", "permission_key");

CREATE INDEX IF NOT EXISTS "member_permission_overrides_tenant_id_membership_id_idx"
  ON "member_permission_overrides" ("tenant_id", "membership_id");

ALTER TABLE "member_permission_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_permission_overrides" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "member_permission_overrides";
CREATE POLICY "tenant_isolation" ON "member_permission_overrides"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "member_permission_overrides" TO leadpilot_app;
  END IF;
END $$;
