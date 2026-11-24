'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleHelp } from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformOpsSkeleton } from '@/components/skeletons';
import { platformApi, type OpsAlert, type OpsHealth, type OpsView } from '@/lib/platform';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN') : '—');
const ago = (seconds: number | null) => (seconds === null ? 'never' : seconds < 90 ? `${seconds} s ago` : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`);
const sevTone = (s: number) => (s === 1 ? 'danger' : s === 2 ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral';
const values = (v: Record<string, number>) => Object.entries(v).map(([k, x]) => `${k}: ${n(x)}`).join(' · ') || '—';

function AlertCard({ a }: { a: OpsAlert }) {
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={sevTone(a.severity)}><AlertTriangle className="h-3 w-3" aria-hidden />Sev {a.severity}</Badge>
        <Badge tone="danger">Firing</Badge>
        <span className="text-[13px] font-medium">{a.title}</span>
      </div>
      <p className="text-helper mt-1.5">{a.hint}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        <div className="flex gap-2"><dt className="text-muted-foreground">Since</dt><dd className="num">{when(a.since)}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">Emails sent</dt><dd className="num">{n(a.notifyCount)}</dd></div>
        <div className="flex gap-2 sm:col-span-2"><dt className="text-muted-foreground">Values</dt><dd className="num break-words">{values(a.values)}</dd></div>
        <div className="flex gap-2 sm:col-span-2"><dt className="text-muted-foreground">Runbook</dt><dd className="break-all font-mono text-[12px]">{a.runbook}</dd></div>
      </dl>
    </li>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]"><span className="text-muted-foreground">{label}</span><span className={`num font-medium ${bad ? 'text-danger' : ''}`}>{value}</span></div>;
}

function Health({ h }: { h: OpsHealth }) {
  return (
    <Card><CardHeader><CardTitle>Health</CardTitle></CardHeader><CardBody className="divide-y divide-border">
      <Row label="Oldest pending outbox event" value={`${n(h.outbox.oldest_pending_seconds)} s`} bad={h.outbox.oldest_pending_seconds > 120} />
      <Row label="Outbox events pending" value={n(h.outbox.pending)} />
      <Row label="Outbox events failed" value={n(h.outbox.failed)} bad={h.outbox.failed > 0} />
      <Row label="Automation runs stuck (running over 15 min)" value={n(h.automation_runs.stuck_running)} bad={h.automation_runs.stuck_running > 0} />
      <Row label="Automation runs queued over 10 min" value={n(h.automation_runs.queued_old)} bad={h.automation_runs.queued_old > 0} />
      <Row label="Automation waits overdue" value={n(h.automation_runs.waiting_overdue)} bad={h.automation_runs.waiting_overdue > 0} />
      <Row label="Automation runs failed, last hour" value={n(h.automation_runs.failed_last_hour)} />
      <Row label="Billing events needing attention" value={n(h.billing_events_needing_attention)} bad={h.billing_events_needing_attention > 0} />
      <Row label="WhatsApp deliveries unprocessed" value={n(h.webhook_events_unprocessed)} bad={h.webhook_events_unprocessed > 0} />
      <Row label="Outbound messages failed, last hour" value={n(h.outbound_messages_failed_last_hour)} />
      <Row label="Customer webhook deliveries overdue" value={n(h.webhook_deliveries.overdue)} bad={h.webhook_deliveries.overdue > 0} />
      <Row label="Customer webhook deliveries failed, last hour" value={n(h.webhook_deliveries.failed_last_hour)} />
      <Row label="Webhook endpoints auto-disabled" value={n(h.webhook_endpoints_disabled)} bad={h.webhook_endpoints_disabled > 0} />
      <Row label="AI runs / failed, last 15 min" value={`${n(h.ai.runs_last_15_min)} / ${n(h.ai.failed_last_15_min)}`} />
      <Row label="AI latency p95, last 24 h" value={h.ai.p95_latency_ms_24h === null ? '—' : `${(h.ai.p95_latency_ms_24h / 1000).toFixed(1)} s`} />
    </CardBody></Card>
  );
}

export default function PlatformOps() {
  const q = useQuery({ queryKey: ['platform-ops'], queryFn: () => platformApi<OpsView>('/ops'), refetchInterval: 30_000 });
  if (q.isPending) return <PlatformOpsSkeleton />;
  if (q.isError) return <><PageHeader title="Ops status" /><p className="text-helper" role="alert">Could not load the ops status. It will retry automatically.</p></>;
  const o = q.data;
  const updated = new Date(q.dataUpdatedAt).toLocaleTimeString('en-IN');
  return (
    <>
      <PageHeader title="Ops status" description={`Is the platform healthy right now? Refreshes every 30 seconds. Last updated ${updated}.`} />
      {o.snapshot.stale ? (
        <div role="status" className="mb-3 flex items-start gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p><strong>Health data is stale.</strong> The last snapshot was {o.snapshot.generatedAt ? ago(o.snapshot.ageSeconds) : 'never taken'}. The background worker may not be running, so the numbers below can be out of date.</p>
        </div>
      ) : null}
      {!o.alertsEnabled ? <p className="text-helper mb-3">Alert emails are off (ALERTS_ENABLED is not set). Current rule state is still shown below.</p> : null}

      <Card className="mb-3"><CardHeader><CardTitle>Firing alerts <span className="num ml-1 font-normal text-muted-foreground">{o.firing.length}</span></CardTitle></CardHeader><CardBody>
        {o.firing.length === 0
          ? <p className="flex items-center gap-2 text-[13px]"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />No alerts firing.</p>
          : <ul className="space-y-2">{o.firing.map((a) => <AlertCard key={a.key} a={a} />)}</ul>}
      </CardBody></Card>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        {o.health ? <Health h={o.health} /> : <Card><CardHeader><CardTitle>Health</CardTitle></CardHeader><CardBody><p className="text-helper">No health snapshot yet. It appears once a worker has run for a minute.</p></CardBody></Card>}
        <div className="space-y-3">
          <Card><CardHeader><CardTitle>Workers and queues</CardTitle></CardHeader><CardBody>
            <div className="divide-y divide-border">
              <Row label="Workers alive" value={n(o.workers.alive)} bad={o.workers.alive === 0} />
              <Row label="Snapshot age" value={o.snapshot.ageSeconds === null ? '—' : `${n(o.snapshot.ageSeconds)} s`} bad={o.snapshot.stale} />
              {o.queues ? <><Row label="Automation queue: waiting" value={n(o.queues.waiting)} /><Row label="Automation queue: active" value={n(o.queues.active)} /><Row label="Automation queue: delayed" value={n(o.queues.delayed)} /><Row label="Automation queue: failed" value={n(o.queues.failed)} bad={o.queues.failed > 0} /></> : null}
            </div>
            {o.workers.instances.length > 0 ? (
              <div className="mt-3 overflow-x-auto"><table className="w-full text-[12px]"><caption className="sr-only">Worker heartbeats</caption><thead><tr className="border-b border-border text-left text-muted-foreground"><th scope="col" className="py-1.5 pr-3 font-medium">Instance</th><th scope="col" className="py-1.5 pr-3 font-medium">Last heartbeat</th><th scope="col" className="py-1.5 font-medium">Version</th></tr></thead><tbody>
                {o.workers.instances.map((w) => <tr key={w.instanceId} className="border-b border-border last:border-0"><td className="py-1.5 pr-3 font-mono">{w.instanceId}</td><td className="num py-1.5 pr-3">{ago(w.ageSeconds)}</td><td className="py-1.5">{w.version ?? '—'}</td></tr>)}
              </tbody></table></div>
            ) : <p className="text-helper mt-3">No live worker heartbeat.</p>}
          </CardBody></Card>
          <Card><CardHeader><CardTitle>Service levels</CardTitle></CardHeader><CardBody className="p-0">
            <div className="overflow-x-auto"><table className="w-full text-[12px]"><caption className="sr-only">Service level objectives</caption><thead><tr className="border-b border-border text-left text-muted-foreground"><th scope="col" className="px-4 py-2 font-medium">Objective</th><th scope="col" className="px-4 py-2 font-medium">Target</th><th scope="col" className="px-4 py-2 font-medium">Now</th></tr></thead><tbody>
              {o.slos.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-2">{s.name}</td><td className="px-4 py-2 text-muted-foreground">{s.objective}</td>
                  <td className="px-4 py-2">{s.current ? <span className="inline-flex items-center gap-1 num">{s.current.ok === null ? null : s.current.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Meets target" /> : <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-label="Misses target" />}{s.current.value}</span> : <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleHelp className="h-3.5 w-3.5" aria-hidden />{s.source === 'external' ? 'External probe' : s.source === 'metrics' ? 'In CloudWatch / access log' : 'No data yet'}</span>}</td>
                </tr>
              ))}
            </tbody></table></div>
          </CardBody></Card>
        </div>
      </div>

      <Card className="mb-3"><CardHeader><CardTitle>All alert rules</CardTitle></CardHeader><CardBody className="p-0">
        <div className="overflow-x-auto"><table className="w-full text-[12px]"><caption className="sr-only">Alert rules and their current state</caption><thead><tr className="border-b border-border text-left text-muted-foreground"><th scope="col" className="px-4 py-2 font-medium">Rule</th><th scope="col" className="px-4 py-2 font-medium">Severity</th><th scope="col" className="px-4 py-2 font-medium">State</th><th scope="col" className="px-4 py-2 font-medium">Values</th></tr></thead><tbody>
          {o.rules.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0 align-top">
              <td className="px-4 py-2">{r.title}<span className="text-helper block font-mono">{r.key}</span></td>
              <td className="px-4 py-2"><Badge tone={sevTone(r.severity)}>Sev {r.severity}</Badge></td>
              <td className="px-4 py-2"><Badge tone={r.state === 'breached' ? 'danger' : r.state === 'ok' ? 'success' : 'neutral'}>{r.state === 'breached' ? 'Breached' : r.state === 'ok' ? 'OK' : 'Unknown'}</Badge></td>
              <td className="num px-4 py-2 break-words text-muted-foreground">{values(r.values)}</td>
            </tr>
          ))}
        </tbody></table></div>
      </CardBody></Card>

      <Card><CardHeader><CardTitle>Recently resolved</CardTitle></CardHeader><CardBody>
        {o.recent.length === 0 ? <p className="text-helper">Nothing resolved yet.</p> : (
          <ul className="divide-y divide-border text-[13px]">{o.recent.map((a) => <li key={a.key} className="flex flex-wrap items-center gap-2 py-2"><Badge tone={sevTone(a.severity)}>Sev {a.severity}</Badge><span>{a.title}</span><span className="text-helper ml-auto">resolved {when(a.resolvedAt)}</span></li>)}</ul>
        )}
      </CardBody></Card>
    </>
  );
}
