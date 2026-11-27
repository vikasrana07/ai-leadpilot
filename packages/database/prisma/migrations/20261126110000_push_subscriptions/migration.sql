CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_user_id_endpoint_key"
  ON "push_subscriptions" ("user_id", "endpoint");

CREATE INDEX IF NOT EXISTS "push_subscriptions_tenant_id_user_id_idx"
  ON "push_subscriptions" ("tenant_id", "user_id");

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "push_subscriptions";
CREATE POLICY "tenant_isolation" ON "push_subscriptions"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions" TO leadpilot_app;
  END IF;
END $$;
