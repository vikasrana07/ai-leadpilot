-- Add validated tenant_id foreign keys for new tenant-scoped tables (S-09)
-- and cascading lead_id foreign key for portal_email_logs (GDPR erasure guard).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_sheet_syncs_tenant_id_fkey') THEN
    ALTER TABLE google_sheet_syncs
      ADD CONSTRAINT google_sheet_syncs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_attachments_tenant_id_fkey') THEN
    ALTER TABLE lead_attachments
      ADD CONSTRAINT lead_attachments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_permission_overrides_tenant_id_fkey') THEN
    ALTER TABLE member_permission_overrides
      ADD CONSTRAINT member_permission_overrides_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_email_configs_tenant_id_fkey') THEN
    ALTER TABLE portal_email_configs
      ADD CONSTRAINT portal_email_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_email_logs_tenant_id_fkey') THEN
    ALTER TABLE portal_email_logs
      ADD CONSTRAINT portal_email_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_tenant_id_fkey') THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slot_rescue_offers_tenant_id_fkey') THEN
    ALTER TABLE slot_rescue_offers
      ADD CONSTRAINT slot_rescue_offers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_email_logs_lead_id_fkey') THEN
    ALTER TABLE portal_email_logs
      ADD CONSTRAINT portal_email_logs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
  END IF;
END $$;
