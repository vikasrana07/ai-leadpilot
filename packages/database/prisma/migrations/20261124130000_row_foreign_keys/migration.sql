-- Audit finding S-09 (phase 2): 38 columns that point at another row (lead_id, membership_id, channel_id, ...) had no foreign key, so a
-- dangling reference was possible and, worse, RLS only checks the child's tenant_id: a buggy service could attach a row to ANOTHER tenant's lead.
-- Every key here is COMPOSITE (tenant_id, <col>) -> parent (tenant_id, id), so the database also refuses a cross-tenant reference.
--
-- Delete behaviour, chosen per column:
--   CASCADE   data that belongs to the parent and means nothing without it (a lead's consents, tasks, conversations; a member's availability).
--             This matches erase_lead() / purge_retention(), which already delete these rows explicitly before the parent.
--   SET NULL  optional links (assignee, property, merge target, lost reason, active version, trigger message): the child outlives the parent.
--   RESTRICT  history that must not vanish or dangle: appointments of a member, messages of a channel, a channel's credential, payments of an invoice.
-- Deliberately NOT constrained (references that must survive their target): *_user_id actors/authors (audit and history outlive a user),
-- polymorphic subject_id, sessions.family_id, and stage_transitions.from/to_stage_id (stage history).
--
-- Existing data: dangling or cross-tenant references are repaired first (SET NULL columns are nulled, owned rows are deleted). A RESTRICT column
-- with a dangling reference aborts the migration instead, because deleting history is a decision for a person, not a migration.
DO $$
DECLARE
  fk record; n bigint; pending text[];
BEGIN
  -- 1. the parents need a (tenant_id, id) key for the composite references to point at
  FOR fk IN SELECT unnest(ARRAY['leads','conversations','messages','ai_runs','api_keys','memberships','integration_credentials','channels','properties','appointments','automation_versions','lost_reasons','invoices']) AS t LOOP
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (tenant_id, id)', fk.t || '_tenant_id_id_key', fk.t);
  END LOOP;

  FOR fk IN
    SELECT * FROM (VALUES
      ('appointments','lead_id','leads','CASCADE'), ('automation_runs','lead_id','leads','CASCADE'), ('consents','lead_id','leads','CASCADE'),
      ('conversations','lead_id','leads','CASCADE'), ('lead_scores','lead_id','leads','CASCADE'), ('portal_login_codes','lead_id','leads','CASCADE'),
      ('portal_sessions','lead_id','leads','CASCADE'), ('tasks','lead_id','leads','CASCADE'),
      ('ai_runs','conversation_id','conversations','CASCADE'), ('sla_breaches','conversation_id','conversations','CASCADE'),
      ('sla_breaches','inbound_message_id','messages','CASCADE'), ('ai_runs','trigger_message_id','messages','SET NULL'),
      ('ai_tool_executions','run_id','ai_runs','CASCADE'), ('idempotency_keys','api_key_id','api_keys','CASCADE'),
      ('availability_rules','membership_id','memberships','CASCADE'), ('availability_exceptions','membership_id','memberships','CASCADE'),
      ('notification_preferences','membership_id','memberships','CASCADE'), ('notifications','membership_id','memberships','CASCADE'),
      ('google_calendar_syncs','membership_id','memberships','CASCADE'),
      ('leads','assigned_membership_id','memberships','SET NULL'), ('conversations','assigned_membership_id','memberships','SET NULL'),
      ('tasks','assignee_membership_id','memberships','SET NULL'), ('appointments','membership_id','memberships','RESTRICT'),
      ('google_calendar_syncs','credential_id','integration_credentials','CASCADE'), ('channels','credential_id','integration_credentials','RESTRICT'),
      ('webhook_events','channel_id','channels','CASCADE'), ('widget_configs','channel_id','channels','CASCADE'), ('messages','channel_id','channels','RESTRICT'),
      ('appointments','property_id','properties','SET NULL'), ('appointments','rescheduled_from_id','appointments','SET NULL'),
      ('automations','active_version_id','automation_versions','SET NULL'),
      ('leads','lost_reason_id','lost_reasons','SET NULL'), ('stage_transitions','lost_reason_id','lost_reasons','SET NULL'),
      ('leads','merged_into_id','leads','SET NULL'), ('payments','invoice_id','invoices','RESTRICT')
    ) AS v(child, col, parent, act)
  LOOP
    -- 2. repair dangling or cross-tenant references
    IF fk.act = 'SET NULL' THEN
      EXECUTE format('UPDATE %I c SET %I = NULL WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I AND p.tenant_id = c.tenant_id)', fk.child, fk.col, fk.col, fk.parent, fk.col);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE 'S-09: cleared % dangling %.%', n, fk.child, fk.col; END IF;
    ELSIF fk.act = 'CASCADE' THEN
      EXECUTE format('DELETE FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I AND p.tenant_id = c.tenant_id)', fk.child, fk.col, fk.parent, fk.col);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN RAISE NOTICE 'S-09: removed % rows from % whose %.% pointed nowhere', n, fk.child, fk.child, fk.col; END IF;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I AND p.tenant_id = c.tenant_id)', fk.child, fk.col, fk.parent, fk.col) INTO n;
      IF n > 0 THEN RAISE EXCEPTION 'S-09: % rows in %.% reference a missing or other-tenant %; resolve them by hand before adding the key (they are history, so this migration will not delete them)', n, fk.child, fk.col, fk.parent; END IF;
    END IF;

    -- 3. the key itself: NOT VALID, then VALIDATE (light lock for the long scan)
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES %I (tenant_id, id) ON DELETE %s%s NOT VALID',
      fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent,
      CASE WHEN fk.act = 'SET NULL' THEN 'SET NULL (' || quote_ident(fk.col) || ')' ELSE fk.act END,
      -- an automation and its first version point at each other and are created in one transaction: the check waits for the commit
      CASE WHEN fk.child = 'automations' THEN ' DEFERRABLE INITIALLY DEFERRED' ELSE '' END);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.child, fk.child || '_' || fk.col || '_fkey');
  END LOOP;
END $$;
