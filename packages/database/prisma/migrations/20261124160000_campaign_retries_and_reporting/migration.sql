-- AlterTable broadcast_campaigns
ALTER TABLE "broadcast_campaigns" ADD COLUMN "replied_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "auto_retry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "auto_retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "next_retry_at" TIMESTAMPTZ(3);
ALTER TABLE "broadcast_campaigns" ADD COLUMN "parent_campaign_id" UUID;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "follow_up_cohort" TEXT;

ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_parent_campaign_id_fkey" FOREIGN KEY ("parent_campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "broadcast_campaigns_tenant_id_parent_campaign_id_idx" ON "broadcast_campaigns"("tenant_id", "parent_campaign_id");

-- AlterTable broadcast_recipients
ALTER TABLE "broadcast_recipients" ADD COLUMN "replied_at" TIMESTAMPTZ(3);
ALTER TABLE "broadcast_recipients" ADD COLUMN "retry_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "broadcast_recipients" ADD COLUMN "delivery_stage" TEXT NOT NULL DEFAULT 'INITIAL';

CREATE INDEX "broadcast_recipients_tenant_id_lead_id_replied_at_idx" ON "broadcast_recipients"("tenant_id", "lead_id", "replied_at");

-- Helper function for sweeping due auto-retries across active tenants
CREATE OR REPLACE FUNCTION list_due_campaign_retries(p_limit int DEFAULT 20) RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id
    FROM broadcast_campaigns c
    JOIN tenants t ON t.id = c.tenant_id AND t.status = 'ACTIVE'
   WHERE c.auto_retry = true
     AND c.status = 'COMPLETED'
     AND c.auto_retry_count < 3
     AND c.failed_count > 0
     AND c.next_retry_at IS NOT NULL
     AND c.next_retry_at <= now()
   ORDER BY c.next_retry_at
   LIMIT GREATEST(p_limit, 1)
$$;

REVOKE ALL ON FUNCTION list_due_campaign_retries(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_due_campaign_retries(int) TO leadpilot_app;
