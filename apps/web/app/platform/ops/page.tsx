'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock,
  Database,
  MessageSquare,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformOpsSkeleton } from '@/components/skeletons';
import { platformApi, type OpsAlert, type OpsView } from '@/lib/platform';
import { cn } from '@/lib/cn';

const n = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('en-IN');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN') : '—');
const ago = (seconds: number | null) =>
  seconds === null
    ? 'never'
    : seconds < 90
      ? `${seconds} s ago`
      : seconds < 5400
        ? `${Math.round(seconds / 60)} min ago`
        : `${Math.round(seconds / 3600)} h ago`;
const sevTone = (s: number) =>
  s === 1 ? 'danger' : s === 2 ? 'warning' : 'neutral';
const values = (v: Record<string, number>) =>
  Object.entries(v)
    .map(([k, x]) => `${k}: ${n(x)}`)
    .join(' · ') || '—';

function AlertCard({ a }: { a: OpsAlert }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={sevTone(a.severity)} className="font-semibold">
            <AlertTriangle className="h-3 w-3 mr-1" aria-hidden />
            Severity {a.severity}
          </Badge>
          <Badge tone="danger">FIRING</Badge>
          <span className="text-[14px] font-semibold text-foreground">{a.title}</span>
        </div>
        <span className="num text-[11px] text-muted-foreground">Since: {when(a.since)}</span>
      </div>

      <p className="mt-2 text-[13px] text-foreground leading-relaxed">{a.hint}</p>

      <div className="mt-3 grid gap-x-4 gap-y-2 rounded-md bg-surface p-3 text-[12px] sm:grid-cols-2 border border-border">
        <div>
          <span className="text-muted-foreground">Notification emails sent:</span>{' '}
          <strong className="num text-foreground">{n(a.notifyCount)}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Trigger values:</span>{' '}
          <strong className="num text-foreground break-all">{values(a.values)}</strong>
        </div>
        <div className="sm:col-span-2 flex items-center gap-1.5 pt-1 border-t border-border/50">
          <span className="text-muted-foreground font-medium">Runbook:</span>
          <code className="font-mono text-[11px] text-primary break-all bg-muted/60 px-1.5 py-0.5 rounded">
            {a.runbook}
          </code>
        </div>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  bad,
  hint,
}: {
  label: string;
  value: string;
  bad?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13px] border-b border-border/50 last:border-0">
      <div>
        <span className="text-muted-foreground">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <span
        className={cn(
          'num font-semibold',
          bad ? 'text-danger bg-danger-soft px-2 py-0.5 rounded' : 'text-foreground'
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function PlatformOps() {
  const q = useQuery({
    queryKey: ['platform-ops'],
    queryFn: () => platformApi<OpsView>('/ops'),
    refetchInterval: 30_000,
  });

  if (q.isPending) return <PlatformOpsSkeleton />;
  if (q.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Ops Status & Reliability" />
        <Card className="p-8 text-center">
          <AlertOctagon className="mx-auto h-10 w-10 text-danger mb-2" />
          <p className="text-[14px] font-semibold text-foreground">Could not load operations status</p>
          <p className="text-helper mt-1">The operations metrics service returned an error. It will retry automatically.</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => void q.refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry Now
          </Button>
        </Card>
      </div>
    );
  }

  const o = q.data;
  const updated = new Date(q.dataUpdatedAt).toLocaleTimeString('en-IN');
  const firingCount = o.firing.length;
  const isHealthy = firingCount === 0 && !o.snapshot.stale;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations & Reliability"
        description={`Real-time platform observability, worker heartbeats, and SLO telemetry. Auto-refreshes every 30s. Last synced at ${updated}.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void q.refetch()}
            loading={q.isFetching}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        }
      />

      {/* Global Status Banner */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 shadow-xs transition-colors',
          isHealthy
            ? 'border-success/30 bg-success-soft/50 text-foreground'
            : o.snapshot.stale
              ? 'border-warning/30 bg-warning-soft/60 text-foreground'
              : 'border-danger/30 bg-danger-soft/60 text-foreground'
        )}
      >
        <div className="flex items-center gap-3.5">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              isHealthy
                ? 'bg-emerald-500 text-white'
                : o.snapshot.stale
                  ? 'bg-amber-500 text-white'
                  : 'bg-rose-500 text-white'
            )}
          >
            {isHealthy ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : (
              <AlertTriangle className="h-6 w-6" />
            )}
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-foreground">
              {isHealthy
                ? 'All Platform Systems Operational'
                : o.snapshot.stale
                  ? 'Worker Telemetry Stale'
                  : `${firingCount} Active Incident ${firingCount === 1 ? 'Rule' : 'Rules'} Firing`}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {isHealthy
                ? 'All background queues, event outbox pipelines, and AI proxies are functioning normally.'
                : o.snapshot.stale
                  ? `Snapshot age is ${ago(o.snapshot.ageSeconds)}. Background worker heartbeats may be delayed.`
                  : 'Platform health alerts require attention. Review firing rules below.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!o.alertsEnabled && (
            <Badge tone="neutral" className="px-2.5 py-1">
              Email Notifications Off
            </Badge>
          )}
          <Badge tone={isHealthy ? 'success' : o.snapshot.stale ? 'warning' : 'danger'}>
            {isHealthy ? 'Operational' : o.snapshot.stale ? 'Stale' : 'Degraded'}
          </Badge>
        </div>
      </div>

      {/* Firing Alerts Section */}
      {firingCount > 0 && (
        <Card className="border-danger/40">
          <CardHeader className="bg-danger-soft/20">
            <div className="flex items-center gap-2 text-danger">
              <AlertTriangle className="h-4 w-4" />
              <CardTitle className="text-danger">
                Active Firing Incidents ({firingCount})
              </CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {o.firing.map((a) => (
              <AlertCard key={a.key} a={a} />
            ))}
          </CardBody>
        </Card>
      )}

      {/* Primary Subsystem Health Grids */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Outbox & Event Pipeline */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <CardTitle>Event Outbox & Pipeline</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {o.health ? (
              <div className="space-y-1">
                <MetricRow
                  label="Oldest Pending Outbox Event"
                  value={`${n(o.health.outbox.oldest_pending_seconds)} s`}
                  bad={o.health.outbox.oldest_pending_seconds > 120}
                  hint="Threshold: > 120s indicates pipeline lag"
                />
                <MetricRow
                  label="Outbox Events Pending"
                  value={n(o.health.outbox.pending)}
                />
                <MetricRow
                  label="Outbox Events Failed"
                  value={n(o.health.outbox.failed)}
                  bad={o.health.outbox.failed > 0}
                />
                <MetricRow
                  label="Billing Events Requiring Attention"
                  value={n(o.health.billing_events_needing_attention)}
                  bad={o.health.billing_events_needing_attention > 0}
                />
              </div>
            ) : (
              <p className="py-6 text-center text-helper">No health telemetry recorded yet.</p>
            )}
          </CardBody>
        </Card>

        {/* Automation Execution Engine */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <CardTitle>Automation Execution Engine</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {o.health ? (
              <div className="space-y-1">
                <MetricRow
                  label="Runs Stuck Running (> 15 min)"
                  value={n(o.health.automation_runs.stuck_running)}
                  bad={o.health.automation_runs.stuck_running > 0}
                />
                <MetricRow
                  label="Runs Queued (> 10 min)"
                  value={n(o.health.automation_runs.queued_old)}
                  bad={o.health.automation_runs.queued_old > 0}
                />
                <MetricRow
                  label="Automation Waits Overdue"
                  value={n(o.health.automation_runs.waiting_overdue)}
                  bad={o.health.automation_runs.waiting_overdue > 0}
                />
                <MetricRow
                  label="Failed Runs (Last Hour)"
                  value={n(o.health.automation_runs.failed_last_hour)}
                />
              </div>
            ) : (
              <p className="py-6 text-center text-helper">No automation telemetry recorded yet.</p>
            )}
          </CardBody>
        </Card>

        {/* Messaging & Webhook Ingestion */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <CardTitle>Messaging & Customer Webhooks</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {o.health ? (
              <div className="space-y-1">
                <MetricRow
                  label="WhatsApp Deliveries Unprocessed"
                  value={n(o.health.webhook_events_unprocessed)}
                  bad={o.health.webhook_events_unprocessed > 0}
                />
                <MetricRow
                  label="Outbound Messages Failed (Last Hour)"
                  value={n(o.health.outbound_messages_failed_last_hour)}
                />
                <MetricRow
                  label="Customer Webhook Deliveries Overdue"
                  value={n(o.health.webhook_deliveries.overdue)}
                  bad={o.health.webhook_deliveries.overdue > 0}
                />
                <MetricRow
                  label="Customer Webhook Endpoints Auto-Disabled"
                  value={n(o.health.webhook_endpoints_disabled)}
                  bad={o.health.webhook_endpoints_disabled > 0}
                  hint="Disabled after repeated backoff failures"
                />
              </div>
            ) : (
              <p className="py-6 text-center text-helper">No messaging telemetry recorded yet.</p>
            )}
          </CardBody>
        </Card>

        {/* AI Inference & Latency */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <CardTitle>AI Gateway & Model Performance</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {o.health ? (
              <div className="space-y-1">
                <MetricRow
                  label="Model Inference Runs (Last 15m)"
                  value={n(o.health.ai.runs_last_15_min)}
                />
                <MetricRow
                  label="Failed AI Calls (Last 15m)"
                  value={n(o.health.ai.failed_last_15_min)}
                  bad={o.health.ai.failed_last_15_min > 0}
                />
                <MetricRow
                  label="AI Latency p95 (Last 24h)"
                  value={
                    o.health.ai.p95_latency_ms_24h === null
                      ? '—'
                      : `${(o.health.ai.p95_latency_ms_24h / 1000).toFixed(2)} s`
                  }
                />
              </div>
            ) : (
              <p className="py-6 text-center text-helper">No AI telemetry recorded yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Workers & Queue Architecture */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <CardTitle>Worker Instances & Heartbeats</CardTitle>
            </div>
            <Badge tone={o.workers.alive && o.workers.alive > 0 ? 'success' : 'danger'}>
              {n(o.workers.alive)} Alive
            </Badge>
          </CardHeader>
          <CardBody>
            {o.workers.instances.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Instance ID</th>
                      <th className="py-2 pr-3 font-medium">Last Heartbeat</th>
                      <th className="py-2 font-medium">Version</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {o.workers.instances.map((w) => (
                      <tr key={w.instanceId} className="hover:bg-muted/40">
                        <td className="py-2 pr-3 font-mono font-medium text-foreground">
                          {w.instanceId}
                        </td>
                        <td className="num py-2 pr-3 text-muted-foreground">{ago(w.ageSeconds)}</td>
                        <td className="py-2 text-muted-foreground">{w.version ?? 'v1.0.0'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-helper">No active worker heartbeat registered.</p>
            )}
          </CardBody>
        </Card>

        {/* Service Level Objectives (SLOs) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <CardTitle>Service Level Objectives (SLOs)</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Objective Name</th>
                    <th className="px-4 py-2.5 font-medium">Target</th>
                    <th className="px-4 py-2.5 font-medium">Current Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {o.slos.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium text-foreground">{s.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.objective}</td>
                      <td className="px-4 py-2.5">
                        {s.current ? (
                          <span className="inline-flex items-center gap-1.5 num font-medium">
                            {s.current.ok === null ? null : s.current.ok ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-rose-500" />
                            )}
                            <span
                              className={
                                s.current.ok === false
                                  ? 'text-rose-600 font-semibold'
                                  : 'text-foreground'
                              }
                            >
                              {s.current.value}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <CircleHelp className="h-3.5 w-3.5" />
                            {s.source === 'external' ? 'External probe' : 'Awaiting data'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Alert Rules State Registry */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              <CardTitle>Alert Rules Registry ({o.rules.length})</CardTitle>
            </div>
            <span className="text-helper text-[12px]">Evaluated continuously by background monitor</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Rule Definition</th>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">Evaluation Values</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.rules.map((r) => (
                  <tr key={r.key} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground">{r.title}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {r.key}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={sevTone(r.severity)}>Sev {r.severity}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          r.state === 'breached'
                            ? 'danger'
                            : r.state === 'ok'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {r.state === 'breached' ? 'Breached' : r.state === 'ok' ? 'Normal' : 'Unknown'}
                      </Badge>
                    </td>
                    <td className="num px-4 py-2.5 text-muted-foreground font-mono text-[11px] break-all">
                      {values(r.values)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Recently Resolved Incidents */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <CardTitle>Recently Resolved Incidents</CardTitle>
          </div>
        </CardHeader>
        <CardBody>
          {o.recent.length === 0 ? (
            <p className="py-4 text-center text-helper">No recent alert resolutions recorded.</p>
          ) : (
            <div className="divide-y divide-border text-[13px]">
              {o.recent.map((a) => (
                <div key={a.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={sevTone(a.severity)}>Sev {a.severity}</Badge>
                    <span className="font-medium text-foreground">{a.title}</span>
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    Resolved: {when(a.resolvedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
