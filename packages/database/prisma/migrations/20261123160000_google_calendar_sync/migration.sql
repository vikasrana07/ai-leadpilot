-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "google_event_id" text;

-- CreateTable
CREATE TABLE "google_calendar_syncs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "credential_id" UUID NOT NULL,
    "sync_token" TEXT,
    "channel_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "email" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "google_calendar_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_syncs_tenant_id_membership_id_key" ON "google_calendar_syncs"("tenant_id", "membership_id");

-- CreateIndex
CREATE INDEX "google_calendar_syncs_tenant_id_idx" ON "google_calendar_syncs"("tenant_id");

-- Row Level Security
ALTER TABLE "google_calendar_syncs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "google_calendar_syncs" FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "google_calendar_syncs" TO leadpilot_app;
