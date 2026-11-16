# Data model outline (Phase 0)

Outline only. The Prisma schema is written in Phase 1 (identity/tenancy) and extended per phase. Every table below marked **T** has `tenant_id NOT NULL` + index + RLS policy (`tenant_id = current_setting('app.tenant_id')::uuid`). **G** = global (no tenant).

## Identity & tenancy (Phase 1)
- `tenants` **G-with-self-policy** — profile, industry, industry_pack_id/version, timezone, currency, status, settings JSONB, onboarding_state JSONB.
- `users` **G** — email (unique, citext), password_hash, email_verified_at, status, is_platform_admin (platform admins live on a separate auth surface, see ADR-0003).
- `memberships` **T** — user_id, role_id, status, invited_by. Unique (tenant_id, user_id).
- `roles` **T** (system roles seeded per tenant) and `permissions` **G** (catalogue of keys), `role_permissions`, `membership_permission_overrides` [V1.1].
- `invitations` **T** — email, role, token_hash, expires_at, accepted_at.
- `sessions` **G** — user_id, refresh_token_hash, family_id, rotated_from, revoked_at, ip, user_agent.
- `email_verification_tokens`, `password_reset_tokens` **G** — hashed, single use, expiring.
- `audit_logs` **T** (append-only; app role INSERT/SELECT only) — actor, action, resource_type/id, metadata, request_id.
- `outbox_events` **T** — type, payload, status, attempts, available_at, processed_at.
- `webhook_events` **G/T** — provider, external_id (unique with provider), raw payload, status. Dedupe + replay.
- `integration_credentials` **T** — provider, ciphertext, key_id, status, last_verified_at. Never returned by APIs.

## CRM (Phase 2)
- `leads` **T** — contact + qualification fields, status, temperature, score, assigned_membership_id, source_id, custom_fields JSONB, normalised phone/email dedupe keys, deleted_at.
- `lead_sources` **T**, `lead_tags`/`tags` **T**, `lead_notes` **T**, `lead_attachments` **T**, `lead_activities` **T** (typed timeline), `lead_merges` **T** (audit).
- `custom_field_definitions` **T** — entity, key, type, options, required.
- `pipelines` / `pipeline_stages` **T** — from Industry Pack, tenant-editable; `stage_transitions` **T**; `lost_reasons` **T**.
- `lead_scores` **T** — score, breakdown JSONB, rule_version, scored_at, source (rule | manual override), override_by.
- `scoring_rule_sets` **T** — versioned rules JSONB.
- `properties` (catalog items) **T** — project/unit, price (minor units), currency, status, location, attributes JSONB, media refs.
- `saved_views` [V1.1].

## Communication (Phase 3)
- `channels` **T** — type (whatsapp | web_widget), config, status. WhatsApp: phone_number_id, waba_id (unique across platform so inbound routing is unambiguous).
- `contacts` **T** (optional split from leads; decision in Phase 3 ADR) with `consents` **T** (channel, status, source, timestamp, evidence).
- `conversations` **T** — channel_id, lead_id, status, mode (ai | human), assigned_membership_id, last_inbound_at (drives 24h window), last_message_at, unread counters.
- `messages` **T** — conversation_id, direction, sender_type (customer | ai | agent | system), content, media refs, external_id (unique per channel), status + status timestamps, idempotency_key.
- `conversation_notes` **T**, `conversation_tags`.
- `whatsapp_templates` **T** [V1.1 manager; MVP stores approved template names].
- `widget_configs` **T** — public_key (unique), allowed_origins, theme, greeting.
- `attachments`/`files` **T** — storage_key (tenant-prefixed), mime, size, scan_status.

## AI (Phase 4)
- `ai_assistants` **T** — settings, working hours, handover rules, allowed tools, disclosure text, active prompt_version.
- `prompt_versions` **G** — template, version, hash, changelog.
- `ai_runs` **T** — conversation_id, message_id, model, prompt_version, input/output tokens, latency, status, error, trace JSONB (tool calls, retrieved chunk ids).
- `ai_tool_executions` **T** — tool, validated input, result, idempotency_key (unique), status.
- `knowledge_documents` **T** — file ref, type, status, error, checksum. `knowledge_chunks` **T** — content, embedding `vector(N)`, embedding_model, metadata JSONB. HNSW index; queries always filter on tenant.
- `ai_eval_cases` / `ai_eval_runs` — dev/CI only.

## Ops (Phase 5)
- `appointments` **T** — lead_id, agent membership_id, `tstzrange` slot, status, notes; **exclusion constraint** (tenant_id, agent, slot WITH &&) for non-cancelled statuses; `appointment_events` history.
- `availability_rules` / `availability_exceptions` **T**.
- `automations` **T** (template key, trigger, conditions JSONB, actions JSONB, enabled), `automation_runs` **T** (status, attempts, error, dry_run), `scheduled_actions` **T**.
- `tasks` / `followups` **T**.
- `notifications` **T**, `notification_preferences` **T**.
- `sla_policies` **T**, `sla_events` **T**.

## Insight & SaaS (Phases 2, 4, 6)
- `usage_events` **T** (append) and `usage_rollups_daily` **T**; `quotas` **T**.
- `analytics_rollups_*` **T** if query plans demand them.
- `plans` **G**, `plan_entitlements` **G**, `subscriptions` **T**, `invoices` **T**, `payments` **T**, `billing_events` **G** (Razorpay webhooks).
- `api_keys` **T** (hashed, scoped) [V1.1], `webhook_endpoints` **T** [V1.1].
- `data_requests` **T** (export/erasure tracking), `retention_policies` **T**.

## Constraints worth calling out
- Unique `(tenant_id, normalised_phone)` is **not** enforced as hard unique on leads (duplicates are detected and surfaced, not blocked); a partial unique index applies only for `deleted_at IS NULL` merge targets where chosen in Phase 2.
- `messages(channel_id, external_id)` unique → webhook dedupe.
- `ai_tool_executions(tenant_id, idempotency_key)` unique.
- Appointment overlap: exclusion constraint (requires `btree_gist`).
