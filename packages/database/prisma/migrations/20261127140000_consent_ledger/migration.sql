-- Consent ledger hardening: proof columns on consents, a suppression list that survives lead erasure, and erase_lead() that feeds it.
CREATE TYPE "ConsentPurpose" AS ENUM ('TRANSACTIONAL', 'SERVICE', 'MARKETING');
CREATE TYPE "ConsentMethod" AS ENUM ('INBOUND_MESSAGE', 'STOP_KEYWORD', 'START_KEYWORD', 'FORM_CHECKBOX', 'META_LEAD_AD', 'MANAGER_ATTESTED', 'CSV_IMPORT', 'API', 'PORTAL', 'WIDGET', 'UNSUBSCRIBE_LINK');
CREATE TYPE "ConsentActorType" AS ENUM ('CUSTOMER', 'MEMBER', 'SYSTEM', 'IMPORT');

ALTER TABLE "consents"
  ADD COLUMN "purpose" "ConsentPurpose" NOT NULL DEFAULT 'MARKETING',
  ADD COLUMN "method" "ConsentMethod",
  ADD COLUMN "actor_type" "ConsentActorType",
  ADD COLUMN "actor_membership_id" uuid,
  ADD COLUMN "text_version" text,
  ADD COLUMN "evidence" jsonb,
  ADD COLUMN "expires_at" timestamptz(3);

-- Backfill from the legacy free-text source. A customer-initiated message was never a marketing opt-in, so legacy inbound rows become SERVICE.
UPDATE "consents" SET method = 'STOP_KEYWORD', actor_type = 'CUSTOMER' WHERE source = 'inbound_stop_keyword';
UPDATE "consents" SET method = 'INBOUND_MESSAGE', actor_type = 'CUSTOMER', purpose = 'SERVICE' WHERE source = 'inbound_message';
UPDATE "consents" SET method = 'META_LEAD_AD', actor_type = 'CUSTOMER' WHERE source = 'meta_lead_ad';
UPDATE "consents" SET method = 'MANAGER_ATTESTED', actor_type = 'MEMBER' WHERE source LIKE 'manager_attested:%';

CREATE TABLE "consent_suppressions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "phone_hash" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "consent_suppressions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "consent_suppressions_tenant_id_channel_phone_hash_key" ON "consent_suppressions"("tenant_id", "channel", "phone_hash");
ALTER TABLE "consent_suppressions" ADD CONSTRAINT "consent_suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation. Append-only for the app role (SELECT, INSERT): the erase_lead() SECURITY DEFINER function writes as the owner.
ALTER TABLE "consent_suppressions" ENABLE ROW LEVEL SECURITY;
-- ENABLE only (no FORCE): erase_lead() is SECURITY DEFINER and writes as the table owner, which FORCE would also filter.
DROP POLICY IF EXISTS "tenant_isolation" ON "consent_suppressions";
CREATE POLICY "tenant_isolation" ON "consent_suppressions" FOR ALL TO leadpilot_app
  USING ("tenant_id" = app_tenant_id()) WITH CHECK ("tenant_id" = app_tenant_id());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leadpilot_app') THEN
    GRANT SELECT, INSERT ON "consent_suppressions" TO leadpilot_app;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION erase_lead(p_tenant uuid, p_lead uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[]; emails text[]; convs uuid[]; appts uuid[]; runs uuid[]; phones text[]; n jsonb := '{}'::jsonb; c int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = p_lead AND tenant_id = p_tenant) THEN RETURN NULL; END IF;
  -- the lead plus any duplicates that were merged into it (their rows still hold the person's data)
  SELECT array_agg(id) INTO ids FROM leads WHERE tenant_id = p_tenant AND (id = p_lead OR merged_into_id = p_lead);
  SELECT COALESCE(array_agg(DISTINCT regexp_replace(p, '\D', '', 'g')) FILTER (WHERE length(regexp_replace(p, '\D', '', 'g')) >= 8), '{}') INTO phones
    FROM leads l, LATERAL unnest(ARRAY[l.phone, l.phone_norm]) p WHERE l.id = ANY(ids);
  SELECT COALESCE(array_agg(DISTINCT lower(email)) FILTER (WHERE email IS NOT NULL AND email <> ''), '{}') INTO emails FROM leads WHERE id = ANY(ids);
  SELECT COALESCE(array_agg(id), '{}') INTO convs FROM conversations WHERE tenant_id = p_tenant AND lead_id = ANY(ids);
  SELECT COALESCE(array_agg(id), '{}') INTO appts FROM appointments WHERE tenant_id = p_tenant AND lead_id = ANY(ids);
  SELECT COALESCE(array_agg(id), '{}') INTO runs FROM ai_runs WHERE tenant_id = p_tenant AND conversation_id = ANY(convs);

  DELETE FROM notifications WHERE tenant_id = p_tenant AND EXISTS (SELECT 1 FROM unnest(ids) i WHERE link LIKE '%' || i::text || '%' OR data::text LIKE '%' || i::text || '%'); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('notifications', c);
  DELETE FROM ai_tool_executions WHERE tenant_id = p_tenant AND run_id = ANY(runs); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('ai_tool_executions', c);
  DELETE FROM ai_runs WHERE tenant_id = p_tenant AND id = ANY(runs); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('ai_runs', c);
  DELETE FROM sla_breaches WHERE tenant_id = p_tenant AND conversation_id = ANY(convs);
  DELETE FROM appointment_events WHERE tenant_id = p_tenant AND appointment_id = ANY(appts);
  DELETE FROM appointments WHERE tenant_id = p_tenant AND id = ANY(appts); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('appointments', c);
  DELETE FROM automation_runs WHERE tenant_id = p_tenant AND lead_id = ANY(ids); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('automation_runs', c);
  DELETE FROM tasks WHERE tenant_id = p_tenant AND lead_id = ANY(ids); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('tasks', c);
  -- An opt-out must survive erasure, otherwise the same number can be re-added and messaged again. Keep only a tenant-salted hash of the
  -- phone (no PII) for leads whose latest WhatsApp consent is OPTED_OUT, then delete the consent rows themselves.
  INSERT INTO consent_suppressions (tenant_id, channel, phone_hash, reason)
    SELECT DISTINCT p_tenant, 'whatsapp', encode(sha256(convert_to(p_tenant::text || ':' || l.phone_norm, 'UTF8')), 'hex'), 'erased_after_opt_out'
    FROM leads l
    WHERE l.id = ANY(ids) AND l.tenant_id = p_tenant AND l.phone_norm IS NOT NULL
      AND (SELECT c2.status::text FROM consents c2 WHERE c2.tenant_id = p_tenant AND c2.lead_id = l.id AND c2.channel = 'whatsapp' ORDER BY c2.created_at DESC LIMIT 1) = 'OPTED_OUT'
    ON CONFLICT (tenant_id, channel, phone_hash) DO NOTHING;
  SELECT count(*) INTO c FROM consent_suppressions WHERE tenant_id = p_tenant AND phone_hash IN (SELECT encode(sha256(convert_to(p_tenant::text || ':' || l.phone_norm, 'UTF8')), 'hex') FROM leads l WHERE l.id = ANY(ids) AND l.phone_norm IS NOT NULL); n := n || jsonb_build_object('consent_suppressions_retained', c);
  DELETE FROM consents WHERE tenant_id = p_tenant AND lead_id = ANY(ids); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('consents', c);
  DELETE FROM lead_scores WHERE tenant_id = p_tenant AND lead_id = ANY(ids); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('lead_scores', c);
  SELECT count(*) INTO c FROM messages WHERE tenant_id = p_tenant AND conversation_id = ANY(convs); n := n || jsonb_build_object('messages', c);
  DELETE FROM conversations WHERE tenant_id = p_tenant AND id = ANY(convs); -- cascades messages and conversation notes
  GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('conversations', c);
  -- raw provider payloads and processed outbox events can embed the person's phone number or lead id
  DELETE FROM webhook_events WHERE tenant_id = p_tenant AND EXISTS (SELECT 1 FROM unnest(phones) ph WHERE payload::text LIKE '%' || ph || '%'); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('webhook_events', c);
  DELETE FROM outbox_events WHERE tenant_id = p_tenant AND status = 'processed' AND payload->>'leadId' = ANY(ids::text[]); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('outbox_events', c);
  -- Email tracking (S-20): tracked_emails.lead_id is ON DELETE SET NULL, so deleting the lead used to leave the address, subject and the
  -- engagement trail (IP, user-agent, clicked URLs) behind. Delete every email sent to the lead (by link OR by address, since a message
  -- sent without choosing a lead still went to this person); engagement events go with them (ON DELETE CASCADE).
  SELECT count(*) INTO c FROM email_engagement_events e WHERE e.tenant_id = p_tenant AND e.email_id IN (SELECT t.id FROM tracked_emails t WHERE t.tenant_id = p_tenant AND (t.lead_id = ANY(ids) OR lower(t.recipient::text) = ANY(emails))); n := n || jsonb_build_object('email_engagement_events', c);
  DELETE FROM tracked_emails WHERE tenant_id = p_tenant AND (lead_id = ANY(ids) OR lower(recipient::text) = ANY(emails)); GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('tracked_emails', c);
  -- The suppression list is the one email record KEPT: it is how the workspace honours a bounce, complaint or unsubscribe, so deleting it
  -- would let the same address be emailed again. The address stays (that is the purpose of the entry); free-text notes, which can hold
  -- anything an agent typed about the person, are cleared. The count is reported so the erasure record shows what was retained and why.
  UPDATE email_suppressions SET notes = NULL WHERE tenant_id = p_tenant AND lower(email::text) = ANY(emails) AND notes IS NOT NULL;
  SELECT count(*) INTO c FROM email_suppressions WHERE tenant_id = p_tenant AND lower(email::text) = ANY(emails); n := n || jsonb_build_object('email_suppressions_retained', c);
  DELETE FROM leads WHERE tenant_id = p_tenant AND id = ANY(ids); -- cascades activities, notes, tags, stage transitions
  GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('leads', c);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION erase_lead(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_lead(uuid, uuid) TO leadpilot_app;
