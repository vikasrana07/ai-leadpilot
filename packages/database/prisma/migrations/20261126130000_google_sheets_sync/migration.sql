CREATE UNIQUE INDEX IF NOT EXISTS "integration_credentials_tenant_id_id_key" ON "integration_credentials" ("tenant_id", "id");

CREATE TABLE IF NOT EXISTS "google_sheet_syncs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "spreadsheet_id" TEXT,
  "spreadsheet_name" TEXT,
  "sheet_name" TEXT NOT NULL DEFAULT 'Sheet1',
  "column_mapping" JSONB NOT NULL DEFAULT '{}',
  "last_synced_row" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "last_synced_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "google_sheet_syncs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "google_sheet_syncs_tenant_cred_fkey"
    FOREIGN KEY ("tenant_id", "credential_id")
    REFERENCES "integration_credentials" ("tenant_id", "id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_sheet_syncs_tenant_id_key" ON "google_sheet_syncs" ("tenant_id");

ALTER TABLE "google_sheet_syncs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_sheet_syncs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "google_sheet_syncs";
CREATE POLICY "tenant_isolation" ON "google_sheet_syncs"
  FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id())
  WITH CHECK ("tenant_id" = app_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "google_sheet_syncs" TO leadpilot_app;
  END IF;
END $$;
