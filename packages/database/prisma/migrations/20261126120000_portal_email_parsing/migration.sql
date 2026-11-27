CREATE TABLE IF NOT EXISTS "portal_email_configs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "webhook_key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_email_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_email_configs_tenant_id_key" ON "portal_email_configs" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_email_configs_webhook_key_key" ON "portal_email_configs" ("webhook_key");

CREATE TABLE IF NOT EXISTS "portal_email_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "portal" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lead_id" UUID,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "portal_email_logs_tenant_id_created_at_idx"
  ON "portal_email_logs" ("tenant_id", "created_at" DESC);

ALTER TABLE "portal_email_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_email_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portal_email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_email_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "portal_email_configs";
CREATE POLICY "tenant_isolation" ON "portal_email_configs"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DROP POLICY IF EXISTS "tenant_isolation" ON "portal_email_logs";
CREATE POLICY "tenant_isolation" ON "portal_email_logs"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "portal_email_configs" TO leadpilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "portal_email_logs" TO leadpilot_app;
  END IF;
END $$;
