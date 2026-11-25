CREATE UNIQUE INDEX IF NOT EXISTS "leads_tenant_id_id_key" ON "leads" ("tenant_id", "id");

CREATE TABLE IF NOT EXISTS "lead_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID,
  "filename" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_attachments_tenant_lead_fkey"
    FOREIGN KEY ("tenant_id", "lead_id")
    REFERENCES "leads" ("tenant_id", "id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "lead_attachments_tenant_id_lead_id_created_at_idx"
  ON "lead_attachments" ("tenant_id", "lead_id", "created_at" DESC);

ALTER TABLE "lead_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_attachments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_attachments_tenant_isolation" ON "lead_attachments";
DROP POLICY IF EXISTS "tenant_isolation" ON "lead_attachments";
CREATE POLICY "tenant_isolation" ON "lead_attachments"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_attachments" TO leadpilot_app;
  END IF;
END $$;
