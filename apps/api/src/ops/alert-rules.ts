import type { OpsSnapshot } from './health-snapshot.service.js';

/**
 * Alert rules for platform monitoring (monitoring milestone 3). Pure and declarative: a rule looks at the latest health snapshot (plus the
 * live worker heartbeats) and says whether it is breached. The alert service turns "breached for N evaluations in a row" into a firing
 * alert, and "fine for 2 evaluations in a row" into a resolved one. Evaluations happen once a minute, so `forMinutes` = N evaluations.
 *
 * Out of scope here on purpose (they need something outside the app): API availability (an external probe of /health/ready), RDS/Redis
 * resource alarms and backups (CloudWatch), AI cost spikes (needs a 7-day baseline) and login-abuse spikes (audit log). See docs/monitoring.md.
 */

export type Severity = 1 | 2 | 3;
export type RuleValues = Record<string, number>;
/** `breached: null` means "cannot tell" (no fresh data): the rule's state is left as it is. */
export interface RuleResult { breached: boolean | null; values: RuleValues }
export interface AlertInput {
  /** Latest snapshot (null if none could be read), its age, and the number of live worker heartbeats (read live, not from the snapshot). */
  snapshot: OpsSnapshot | null;
  snapshotAgeSeconds: number | null;
  workersAlive: number | null;
}
export interface AlertRule {
  key: string;
  severity: Severity;
  title: string;
  /** What it means and what to do first (one or two sentences, no personal data). */
  hint: string;
  /** Runbook path in this repository. */
  runbook: string;
  /** Consecutive failing evaluations (about minutes) before the alert fires. */
  forMinutes: number;
  evaluate(input: AlertInput): RuleResult;
}

/** All thresholds in one place. */
export const THRESHOLDS = {
  snapshotStaleSeconds: 180,
  outboxLagSeconds: 120,
  aiMinRuns: 10,
  aiFailureRate: 0.2,
  outboundFailedPerHour: 10,
  webhookDeliveriesFailedPerHour: 20,
  /** An alert resolves after this many consecutive fine evaluations (hysteresis, avoids flapping). */
  resolveAfterOk: 2,
} as const;

const fresh = (i: AlertInput): OpsSnapshot | null => (i.snapshot !== null && i.snapshotAgeSeconds !== null && i.snapshotAgeSeconds <= THRESHOLDS.snapshotStaleSeconds ? i.snapshot : null);
const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
/** A rule that only reads the database part of a FRESH snapshot; with no fresh data it cannot tell. */
const onDb = (f: (d: OpsSnapshot['db']) => { breached: boolean; values: RuleValues }) => (i: AlertInput): RuleResult => {
  const s = fresh(i);
  return s ? f(s.db) : { breached: null, values: {} };
};

export const ALERT_RULES: readonly AlertRule[] = [
  {
    key: 'snapshot_stale', severity: 2, forMinutes: 2, runbook: 'docs/runbooks/worker-and-queues.md',
    title: 'Health snapshot is stale: the maintenance job is not running',
    hint: 'No fresh health snapshot for 3 minutes, so most other alerts cannot be evaluated. Check that a worker is running and that Redis and the database are reachable.',
    evaluate: (i) => ({ breached: i.snapshot === null || i.snapshotAgeSeconds === null || i.snapshotAgeSeconds > THRESHOLDS.snapshotStaleSeconds, values: { snapshotAgeSeconds: i.snapshotAgeSeconds ?? -1 } }),
  },
  {
    key: 'worker_not_running', severity: 2, forMinutes: 3, runbook: 'docs/runbooks/worker-and-queues.md',
    title: 'No background worker is running',
    hint: 'No worker heartbeat in Redis. Automations, webhooks, billing jobs and the outbox are not being processed. Start or restart the worker.',
    evaluate: (i): RuleResult => (i.workersAlive === null ? { breached: null, values: {} } : { breached: i.workersAlive === 0, values: { workersAlive: i.workersAlive } }),
  },
  {
    key: 'outbox_lag', severity: 2, forMinutes: 5, runbook: 'docs/runbooks/worker-and-queues.md',
    title: 'Outbox events are waiting too long',
    hint: 'The oldest pending outbox event is older than 2 minutes: events (automations, notifications, webhooks) are delayed. Check the worker and the outbox relay.',
    evaluate: onDb((d) => ({ breached: n(d.outbox.oldest_pending_seconds) > THRESHOLDS.outboxLagSeconds, values: { oldestPendingSeconds: n(d.outbox.oldest_pending_seconds), pending: n(d.outbox.pending) } })),
  },
  {
    key: 'outbox_failed', severity: 3, forMinutes: 1, runbook: 'docs/runbooks/worker-and-queues.md',
    title: 'Outbox events have failed',
    hint: 'At least one outbox event exhausted its retries. Inspect the failed rows (status failed) and re-queue or fix the cause.',
    evaluate: onDb((d) => ({ breached: n(d.outbox.failed) > 0, values: { failed: n(d.outbox.failed) } })),
  },
  {
    key: 'automation_runs_stuck', severity: 3, forMinutes: 1, runbook: 'docs/runbooks/worker-and-queues.md',
    title: 'Automation runs are stuck',
    hint: 'A run has been RUNNING for over 15 minutes or QUEUED for over 10 minutes. The worker may have crashed mid-run; the sweeper re-queues RUNNING runs after 10 minutes.',
    evaluate: onDb((d) => ({ breached: n(d.automation_runs.stuck_running) > 0 || n(d.automation_runs.queued_old) > 0, values: { stuckRunning: n(d.automation_runs.stuck_running), queuedOld: n(d.automation_runs.queued_old) } })),
  },
  {
    key: 'automation_waits_overdue', severity: 2, forMinutes: 1, runbook: 'docs/runbooks/worker-and-queues.md',
    title: 'Automation waits are overdue',
    hint: 'A waiting automation run is more than 15 minutes past its resume time: the scanner is not resuming waits. Check the maintenance job.',
    evaluate: onDb((d) => ({ breached: n(d.automation_runs.waiting_overdue) > 0, values: { waitingOverdue: n(d.automation_runs.waiting_overdue) } })),
  },
  {
    key: 'billing_events_attention', severity: 2, forMinutes: 1, runbook: 'docs/runbooks/billing-incident.md',
    title: 'Billing webhook events need attention',
    hint: 'A payment-provider event has been failed or unprocessed for over 15 minutes. Customers may have paid without getting access. Follow the billing incident runbook.',
    evaluate: onDb((d) => ({ breached: n(d.billing_events_needing_attention) > 0, values: { events: n(d.billing_events_needing_attention) } })),
  },
  {
    key: 'whatsapp_unprocessed', severity: 2, forMinutes: 1, runbook: 'docs/runbooks/webhooks.md',
    title: 'WhatsApp deliveries are unprocessed',
    hint: 'Received WhatsApp webhook events have not been processed for over 5 minutes: customer messages may be missing from the inbox. Follow the webhooks runbook.',
    evaluate: onDb((d) => ({ breached: n(d.webhook_events_unprocessed) > 0, values: { unprocessed: n(d.webhook_events_unprocessed) } })),
  },
  {
    key: 'ai_failure_rate', severity: 2, forMinutes: 1, runbook: 'docs/runbooks/ai-incident.md',
    title: 'AI assistant failure rate is high',
    hint: 'More than 20% of AI runs failed in the last 15 minutes. Check the provider status and consider the AI kill switch (AI_KILL_SWITCH).',
    evaluate: onDb((d) => {
      const runs = n(d.ai.runs_last_15_min); const failed = n(d.ai.failed_last_15_min);
      return { breached: runs >= THRESHOLDS.aiMinRuns && failed / runs > THRESHOLDS.aiFailureRate, values: { runs, failed } };
    }),
  },
  {
    key: 'outbound_messages_failing', severity: 3, forMinutes: 1, runbook: 'docs/runbooks/webhooks.md',
    title: 'Outbound messages are failing',
    hint: 'Ten or more outbound messages failed in the last hour. Check the WhatsApp provider status and channel credentials.',
    evaluate: onDb((d) => ({ breached: n(d.outbound_messages_failed_last_hour) >= THRESHOLDS.outboundFailedPerHour, values: { failedLastHour: n(d.outbound_messages_failed_last_hour) } })),
  },
  {
    key: 'webhook_deliveries_failing', severity: 3, forMinutes: 1, runbook: 'docs/runbooks/webhooks.md',
    title: 'Customer webhook deliveries are failing',
    hint: 'Outbound webhook deliveries are overdue or failing, or an endpoint was auto-disabled. This usually points at a customer endpoint; check delivery logs before assuming a platform fault.',
    evaluate: onDb((d) => ({
      breached: n(d.webhook_deliveries.overdue) > 0 || n(d.webhook_deliveries.failed_last_hour) >= THRESHOLDS.webhookDeliveriesFailedPerHour || n(d.webhook_endpoints_disabled) > 0,
      values: { overdue: n(d.webhook_deliveries.overdue), failedLastHour: n(d.webhook_deliveries.failed_last_hour), endpointsDisabled: n(d.webhook_endpoints_disabled) },
    })),
  },
];

export const RULES_BY_KEY: ReadonlyMap<string, AlertRule> = new Map(ALERT_RULES.map((r) => [r.key, r]));

/** Evaluates every rule against one input. */
export function evaluateRules(input: AlertInput): { rule: AlertRule; result: RuleResult }[] {
  return ALERT_RULES.map((rule) => ({ rule, result: rule.evaluate(input) }));
}

/** Who gets alert email: ALERT_EMAIL_TO (comma separated) when set, otherwise the active platform admins. */
export function pickRecipients(configured: string | undefined, adminEmails: readonly string[]): string[] {
  const list = (configured ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
  const chosen = list.length > 0 ? list : adminEmails.map((s) => s.trim().toLowerCase());
  return [...new Set(chosen)];
}

/** Plain-text alert email. Rule text and numbers only: no tenant names, emails or message content. */
export function alertEmail(kind: 'firing' | 'repeat' | 'resolved', a: { rule: Pick<AlertRule, 'key' | 'severity' | 'title' | 'hint' | 'runbook'>; since: Date | null; resolvedAt?: Date | null; values: RuleValues; webOrigin: string }): { subject: string; text: string } {
  const sev = `Sev ${a.rule.severity}`;
  const tag = kind === 'resolved' ? 'RESOLVED' : kind === 'repeat' ? 'STILL FIRING' : 'FIRING';
  const values = Object.entries(a.values).map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  (no values)';
  const lines = [
    `${tag} [${sev}] ${a.rule.title}`, '',
    `Alert: ${a.rule.key}`,
    ...(a.since ? [`Since: ${a.since.toISOString()}`] : []),
    ...(kind === 'resolved' && a.resolvedAt ? [`Resolved: ${a.resolvedAt.toISOString()}`] : []),
    '', 'Latest values:', values, '',
    ...(kind === 'resolved' ? [] : ['What it means:', `  ${a.rule.hint}`, '']),
    `Runbook: ${a.rule.runbook}`,
    `Ops status: ${a.webOrigin}/platform/ops`,
  ];
  return { subject: `[LeadPilot ${tag}] ${sev}: ${a.rule.title}`, text: lines.join('\n') };
}
