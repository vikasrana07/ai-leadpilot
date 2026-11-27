/**
 * Classification of EVERY table that carries a tenant_id, for the workspace export. A test fails when a new tenant table is in neither
 * list, so adding a table forces a decision: is this the customer's data (export it) or internal/secret/derived (say why not).
 * Value = columns removed from the export (secrets, hashes, internal storage paths).
 */
export const EXPORT_INCLUDED: Record<string, readonly string[]> = {
  ai_assistants: [], ai_runs: [], appointment_events: [], appointments: [], audit_logs: [], automation_runs: [], automation_versions: [], automations: [],
  availability_exceptions: [], availability_rules: [], billing_profiles: [],
  channels: ['webhook_key', 'config', 'credential_id'], // connection secrets stay out; name, type, number and status are exported
  consents: [], conversation_notes: [], conversations: [], custom_field_definitions: [],
  invitations: ['token_hash'], invoices: [], knowledge_documents: ['storage_key'],
  lead_activities: [], lead_notes: [], lead_scores: [], lead_sources: [], lead_tags: [], leads: [], lost_reasons: [],
  memberships: [], messages: [], notification_preferences: [], notifications: [], payments: [], pipeline_stages: [], properties: [],
  role_permissions: [], roles: [], scoring_rule_sets: [], sla_breaches: [], stage_transitions: [], subscriptions: [], tags: [], tasks: [],
  whatsapp_templates: [], widget_configs: [],
  // Outbound campaigns, tracked email and calendar links. The customer's own data is exported; provider message ids and token references are not.
  broadcast_campaigns: [], broadcast_recipients: [], email_engagement_events: [], email_suppressions: [],
  tracked_emails: ['ses_message_id', 'smtp_message_id'],
  google_calendar_syncs: ['credential_id', 'sync_token', 'channel_id'],
  portal_configs: ['public_key'], // the customer-portal settings are exported; the address key is not (it is re-created when the portal is set up again)
  google_sheet_syncs: ['credential_id'],
  lead_attachments: ['storage_key'],
  member_permission_overrides: [],
  portal_email_configs: ['webhook_key'],
  slot_rescue_offers: ['claim_token'],
};

export const EXPORT_EXCLUDED: Record<string, string> = {
  consent_suppressions: 'tenant-salted phone hashes kept only so an erased person\'s opt-out is still honoured; no readable personal data (consents is exported)',
  api_keys: 'hashed secrets', integration_credentials: 'encrypted provider secrets', knowledge_chunks: 'derived embeddings of the exported documents',
  ai_tool_executions: 'internal execution log (ai_runs is exported)', event_marks: 'internal de-duplication markers', outbox_events: 'internal event queue',
  webhook_events: 'raw provider payloads (short retention; duplicates of messages)', platform_audit_logs: 'platform-owned record, not tenant data',
  data_exports: 'export bookkeeping', tenant_deletion_requests: 'deletion bookkeeping',
  idempotency_keys: 'internal request de-duplication', webhook_endpoints: 'contains signing secrets; re-create after migrating', webhook_deliveries: 'delivery logs for outbound webhooks',
  support_access_sessions: 'platform support access records (platform-owned)',
  portal_login_codes: 'short-lived sign-in security records of the customer portal', portal_sessions: 'short-lived sign-in sessions of the customer portal',
  portal_email_logs: 'raw inbound email ingest logs (short retention; created leads are exported)',
  push_subscriptions: 'device-bound Web Push endpoint keys (re-subscribed per browser)',
};
