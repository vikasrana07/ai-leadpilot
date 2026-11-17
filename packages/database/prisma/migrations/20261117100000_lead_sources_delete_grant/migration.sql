-- Switching industry during onboarding (before any lead exists) replaces the pack's lead sources, e.g. drops "Property portal" for a
-- coaching workspace. Row-level security (tenant_isolation, FOR ALL) already limits deletes to the caller's own workspace; only the
-- table privilege was missing. leads.source_id still blocks deleting a source that leads use.
GRANT DELETE ON lead_sources TO leadpilot_app;
