-- DPDP erasure: permanently delete everything held about one lead (the data principal) inside one tenant.
-- A single audited SECURITY DEFINER function instead of broad DELETE grants: the app role still cannot delete consents, messages,
-- appointments... directly; it can only call this, with an explicit tenant that the function verifies against the lead.
CREATE OR REPLACE FUNCTION erase_lead(p_tenant uuid, p_lead uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[]; convs uuid[]; appts uuid[]; runs uuid[]; phones text[]; n jsonb := '{}'::jsonb; c int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = p_lead AND tenant_id = p_tenant) THEN RETURN NULL; END IF;
  -- the lead plus any duplicates that were merged into it (their rows still hold the person's data)
  SELECT array_agg(id) INTO ids FROM leads WHERE tenant_id = p_tenant AND (id = p_lead OR merged_into_id = p_lead);
  SELECT COALESCE(array_agg(DISTINCT regexp_replace(p, '\D', '', 'g')) FILTER (WHERE length(regexp_replace(p, '\D', '', 'g')) >= 8), '{}') INTO phones
    FROM leads l, LATERAL unnest(ARRAY[l.phone, l.phone_norm]) p WHERE l.id = ANY(ids);
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
  DELETE FROM leads WHERE tenant_id = p_tenant AND id = ANY(ids); -- cascades activities, notes, tags, stage transitions
  GET DIAGNOSTICS c = ROW_COUNT; n := n || jsonb_build_object('leads', c);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION erase_lead(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_lead(uuid, uuid) TO leadpilot_app;
