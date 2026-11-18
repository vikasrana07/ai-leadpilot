import { describe, expect, it } from 'vitest';
import { ALERT_RULES, RULES_BY_KEY, THRESHOLDS, alertEmail, evaluateRules, pickRecipients, type AlertInput } from '../src/ops/alert-rules.js';
import type { DbSnapshot, OpsSnapshot } from '../src/ops/health-snapshot.service.js';

const quietDb = (): DbSnapshot => ({
  generated_at: '2026-11-17T10:00:00Z', outbox: { pending: 0, oldest_pending_seconds: 0, failed: 0 },
  automation_runs: { stuck_running: 0, queued_old: 0, waiting_overdue: 0, failed_last_hour: 0 }, billing_events_needing_attention: 0, webhook_events_unprocessed: 0,
  outbound_messages_failed_last_hour: 0, webhook_deliveries: { overdue: 0, failed_last_hour: 0 }, webhook_endpoints_disabled: 0, ai: { runs_last_15_min: 0, failed_last_15_min: 0, p95_latency_ms_24h: null },
});
const input = (patch: (d: DbSnapshot) => void = () => undefined, over: Partial<AlertInput> = {}): AlertInput => {
  const db = quietDb(); patch(db);
  const snapshot: OpsSnapshot = { generatedAt: '2026-11-17T10:00:00Z', db, queues: { waiting: 0, active: 0, delayed: 0, failed: 0 }, workers: { alive: 1, newestBeatAgeSeconds: 3, instances: [] } };
  return { snapshot, snapshotAgeSeconds: 10, workersAlive: 1, ...over };
};
const breached = (key: string, i: AlertInput) => (RULES_BY_KEY.get(key) as (typeof ALERT_RULES)[number]).evaluate(i).breached;

describe('alert rules: thresholds', () => {
  it('a quiet system breaches nothing', () => {
    for (const { rule, result } of evaluateRules(input())) expect(result.breached, rule.key).toBe(false);
  });
  it('every rule has a severity 1-3, a runbook, a hint and a positive forMinutes, and keys are unique', () => {
    expect(new Set(ALERT_RULES.map((r) => r.key)).size).toBe(ALERT_RULES.length);
    for (const r of ALERT_RULES) { expect([1, 2, 3]).toContain(r.severity); expect(r.runbook).toMatch(/^docs\/runbooks\/.+\.md$/); expect(r.hint.length).toBeGreaterThan(20); expect(r.forMinutes).toBeGreaterThanOrEqual(1); }
  });
  it('outbox lag: breached only above 120 s', () => {
    expect(breached('outbox_lag', input((d) => { d.outbox.oldest_pending_seconds = THRESHOLDS.outboxLagSeconds; }))).toBe(false);
    expect(breached('outbox_lag', input((d) => { d.outbox.oldest_pending_seconds = THRESHOLDS.outboxLagSeconds + 1; }))).toBe(true);
  });
  it('outbox failed: any failed row', () => {
    expect(breached('outbox_failed', input((d) => { d.outbox.failed = 1; }))).toBe(true);
  });
  it('stuck runs: stuck RUNNING or old QUEUED', () => {
    expect(breached('automation_runs_stuck', input((d) => { d.automation_runs.stuck_running = 1; }))).toBe(true);
    expect(breached('automation_runs_stuck', input((d) => { d.automation_runs.queued_old = 2; }))).toBe(true);
  });
  it('waits overdue, billing, whatsapp: any', () => {
    expect(breached('automation_waits_overdue', input((d) => { d.automation_runs.waiting_overdue = 1; }))).toBe(true);
    expect(breached('billing_events_attention', input((d) => { d.billing_events_needing_attention = 1; }))).toBe(true);
    expect(breached('whatsapp_unprocessed', input((d) => { d.webhook_events_unprocessed = 1; }))).toBe(true);
  });
  it('AI failure rate: needs the minimum sample and more than 20%', () => {
    expect(breached('ai_failure_rate', input((d) => { d.ai.runs_last_15_min = 5; d.ai.failed_last_15_min = 5; }))).toBe(false); // too few runs to say
    expect(breached('ai_failure_rate', input((d) => { d.ai.runs_last_15_min = 10; d.ai.failed_last_15_min = 2; }))).toBe(false); // exactly 20%
    expect(breached('ai_failure_rate', input((d) => { d.ai.runs_last_15_min = 10; d.ai.failed_last_15_min = 3; }))).toBe(true);
  });
  it('outbound failures: ten or more in the hour; webhook deliveries: overdue, 20 failures, or a disabled endpoint', () => {
    expect(breached('outbound_messages_failing', input((d) => { d.outbound_messages_failed_last_hour = 9; }))).toBe(false);
    expect(breached('outbound_messages_failing', input((d) => { d.outbound_messages_failed_last_hour = 10; }))).toBe(true);
    expect(breached('webhook_deliveries_failing', input((d) => { d.webhook_deliveries.failed_last_hour = 19; }))).toBe(false);
    expect(breached('webhook_deliveries_failing', input((d) => { d.webhook_deliveries.failed_last_hour = 20; }))).toBe(true);
    expect(breached('webhook_deliveries_failing', input((d) => { d.webhook_endpoints_disabled = 1; }))).toBe(true);
    expect(breached('webhook_deliveries_failing', input((d) => { d.webhook_deliveries.overdue = 1; }))).toBe(true);
  });
  it('worker not running: only when the live heartbeat count is zero; unknown when Redis cannot be read', () => {
    expect(breached('worker_not_running', input(undefined, { workersAlive: 0 }))).toBe(true);
    expect(breached('worker_not_running', input(undefined, { workersAlive: 2 }))).toBe(false);
    expect(breached('worker_not_running', input(undefined, { workersAlive: null }))).toBe(null);
  });
});

describe('alert rules: stale or missing data', () => {
  it('snapshot_stale breaches when there is no snapshot or it is older than 3 minutes', () => {
    expect(breached('snapshot_stale', input(undefined, { snapshotAgeSeconds: THRESHOLDS.snapshotStaleSeconds }))).toBe(false);
    expect(breached('snapshot_stale', input(undefined, { snapshotAgeSeconds: THRESHOLDS.snapshotStaleSeconds + 1 }))).toBe(true);
    expect(breached('snapshot_stale', { snapshot: null, snapshotAgeSeconds: null, workersAlive: 1 })).toBe(true);
  });
  it('database rules cannot tell (null, not false) without a fresh snapshot, so their state is left alone', () => {
    const stale = input((d) => { d.outbox.failed = 5; }, { snapshotAgeSeconds: 500 });
    for (const key of ['outbox_failed', 'outbox_lag', 'automation_runs_stuck', 'billing_events_attention', 'ai_failure_rate']) expect(breached(key, stale), key).toBe(null);
    expect(breached('outbox_failed', { snapshot: null, snapshotAgeSeconds: null, workersAlive: 1 })).toBe(null);
  });
});

describe('alert recipients and email text', () => {
  it('uses ALERT_EMAIL_TO when set (trimmed, lower-cased, de-duplicated), otherwise the platform admins', () => {
    expect(pickRecipients(' Ops@Example.test , ops@example.test,not-an-address, b@example.test ', ['admin@example.test'])).toEqual(['ops@example.test', 'b@example.test']);
    expect(pickRecipients(undefined, ['A@x.test', 'a@x.test', 'b@x.test'])).toEqual(['a@x.test', 'b@x.test']);
    expect(pickRecipients('   ', ['admin@example.test'])).toEqual(['admin@example.test']);
    expect(pickRecipients(undefined, [])).toEqual([]);
  });
  it('the email carries severity, title, since, numbers and links, and nothing else', () => {
    const rule = RULES_BY_KEY.get('worker_not_running') as (typeof ALERT_RULES)[number];
    const firing = alertEmail('firing', { rule, since: new Date('2026-11-17T10:00:00Z'), values: { workersAlive: 0 }, webOrigin: 'https://app.example.test' });
    expect(firing.subject).toBe('[LeadPilot FIRING] Sev 2: No background worker is running');
    expect(firing.text).toContain('Since: 2026-11-17T10:00:00.000Z'); expect(firing.text).toContain('workersAlive: 0');
    expect(firing.text).toContain('Runbook: docs/runbooks/worker-and-queues.md'); expect(firing.text).toContain('https://app.example.test/platform/ops');
    const repeat = alertEmail('repeat', { rule, since: new Date('2026-11-17T10:00:00Z'), values: { workersAlive: 0 }, webOrigin: 'https://app.example.test' });
    expect(repeat.subject).toContain('STILL FIRING');
    const resolved = alertEmail('resolved', { rule, since: new Date('2026-11-17T10:00:00Z'), resolvedAt: new Date('2026-11-17T10:09:00Z'), values: { workersAlive: 1 }, webOrigin: 'https://app.example.test' });
    expect(resolved.subject).toContain('RESOLVED'); expect(resolved.text).toContain('Resolved: 2026-11-17T10:09:00.000Z'); expect(resolved.text).not.toContain('What it means');
  });
});
