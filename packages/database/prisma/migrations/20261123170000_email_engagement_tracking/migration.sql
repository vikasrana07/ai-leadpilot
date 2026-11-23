-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'REJECTED', 'SUPPRESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('SEND', 'DELIVERY', 'OPEN', 'CLICK', 'BOUNCE', 'COMPLAINT', 'REJECT');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'UNSUBSCRIBED', 'MANUAL');

-- CreateTable
CREATE TABLE "tracked_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID,
    "recipient" CITEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "ses_message_id" TEXT,
    "smtp_message_id" TEXT,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "first_opened_at" TIMESTAMPTZ(3),
    "last_opened_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "bounced_at" TIMESTAMPTZ(3),
    "bounce_type" TEXT,
    "bounce_sub_type" TEXT,
    "complaint_at" TIMESTAMPTZ(3),
    "complaint_feedback_type" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tracked_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_engagement_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "click_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "email_engagement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracked_emails_tenant_id_created_at_idx" ON "tracked_emails"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tracked_emails_tenant_id_recipient_idx" ON "tracked_emails"("tenant_id", "recipient");

-- CreateIndex
CREATE INDEX "tracked_emails_tenant_id_lead_id_idx" ON "tracked_emails"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "tracked_emails_ses_message_id_idx" ON "tracked_emails"("ses_message_id");

-- CreateIndex
CREATE INDEX "email_engagement_events_tenant_id_email_id_timestamp_idx" ON "email_engagement_events"("tenant_id", "email_id", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_tenant_id_email_key" ON "email_suppressions"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "email_suppressions_tenant_id_created_at_idx" ON "email_suppressions"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "tracked_emails" ADD CONSTRAINT "tracked_emails_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_engagement_events" ADD CONSTRAINT "email_engagement_events_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "tracked_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "tracked_emails" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tracked_emails" FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "tracked_emails" TO leadpilot_app;

ALTER TABLE "email_engagement_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_engagement_events" FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_engagement_events" TO leadpilot_app;

ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_suppressions" FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_suppressions" TO leadpilot_app;
