-- Operations health snapshot (monitoring milestone 2). One jsonb value with COUNTS and AGES ONLY across all workspaces: no tenant ids,
-- no names, no content. It feeds the once-a-minute metrics tick, the Ops Status page and the alert rules. The thresholds mirror the
-- queries in docs/slos-and-alerts.md and docs/runbooks/worker-and-queues.md.
-- SECURITY DEFINER because it must count rows of every workspace (the app role is bound by row-level security); it returns nothing
-- that identifies a workspace or a person, search_path is pinned, and only the app role may execute it.
CREATE OR REPLACE FUNCTION ops_health_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'outbox', (SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status IN ('pending', 'processing')),
        'oldest_pending_seconds', COALESCE(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE status IN ('pending', 'processing')))::bigint, 0),
        'failed', count(*) FILTER (WHERE status = 'failed'))
      FROM outbox_events WHERE status IN ('pending', 'processing', 'failed')),
    'automation_runs', (SELECT jsonb_build_object(
        'stuck_running', count(*) FILTER (WHERE status = 'RUNNING' AND started_at < now() - interval '15 minutes'),
        'queued_old', count(*) FILTER (WHERE status = 'QUEUED' AND created_at < now() - interval '10 minutes'),
        'waiting_overdue', count(*) FILTER (WHERE status = 'WAITING' AND resume_at < now() - interval '15 minutes'),
        'failed_last_hour', count(*) FILTER (WHERE status = 'FAILED' AND created_at > now() - interval '1 hour'))
      FROM automation_runs WHERE status IN ('RUNNING', 'QUEUED', 'WAITING') OR created_at > now() - interval '1 hour'),
    'billing_events_needing_attention', (SELECT count(*) FROM billing_events WHERE status IN ('failed', 'received') AND received_at < now() - interval '15 minutes'),
    'webhook_events_unprocessed', (SELECT count(*) FROM webhook_events WHERE status = 'received' AND created_at < now() - interval '5 minutes'),
    'outbound_messages_failed_last_hour', (SELECT count(*) FROM messages WHERE direction = 'OUTBOUND' AND status = 'FAILED' AND created_at > now() - interval '1 hour'),
    'webhook_deliveries', (SELECT jsonb_build_object(
        'overdue', count(*) FILTER (WHERE status = 'PENDING' AND next_attempt_at < now() - interval '10 minutes'),
        'failed_last_hour', count(*) FILTER (WHERE status = 'FAILED' AND created_at > now() - interval '1 hour'))
      FROM webhook_deliveries WHERE status = 'PENDING' OR created_at > now() - interval '1 hour'),
    'webhook_endpoints_disabled', (SELECT count(*) FROM webhook_endpoints WHERE enabled = false),
    'ai', (SELECT jsonb_build_object(
        'runs_last_15_min', count(*) FILTER (WHERE created_at > now() - interval '15 minutes'),
        'failed_last_15_min', count(*) FILTER (WHERE created_at > now() - interval '15 minutes' AND status = 'FAILED'),
        'p95_latency_ms_24h', (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'COMPLETED' AND latency_ms IS NOT NULL))::numeric(12,1))
      FROM ai_runs WHERE created_at > now() - interval '24 hours')
  );
$$;
REVOKE ALL ON FUNCTION ops_health_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_health_snapshot() TO leadpilot_app;
