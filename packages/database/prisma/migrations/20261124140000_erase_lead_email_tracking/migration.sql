-- Audit finding S-20: erase_lead() did not cover email tracking. tracked_emails keeps its lead link as ON DELETE SET NULL, so after a DPDP erasure the
-- person's address, subject lines and engagement trail (IP, user-agent, clicked URLs) were still stored. This redefines the function (same signature,
-- same grants) to delete them, and to keep only the suppression entry for the address (with its notes cleared), reporting both in the result.
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
