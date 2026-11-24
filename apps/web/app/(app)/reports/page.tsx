'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { downloadReportCsv, fmt, RANGES, REPORTS, reportQuery, type RangeKey, type ReportData, type ReportKey } from '@/lib/reports';
import type { BillingSummary } from '@/lib/billing';
import { useTerms } from '@/lib/pack';
import { applyTerms } from '@/lib/terms-text';

const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)', boxShadow: 'var(--shadow-md)' };
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];

interface ChartSpec { kind: 'area' | 'bar'; data: string; x: string; keys: { key: string; label: string }[]; layout?: 'vertical'; title: string }
const CHARTS: Record<ReportKey, ChartSpec[]> = {
  acquisition: [{ kind: 'area', data: 'trend', x: 'date', keys: [{ key: 'leads', label: 'Leads' }], title: 'Leads per day' }],
  funnel: [{ kind: 'bar', data: 'funnel', x: 'stage', keys: [{ key: 'reached', label: 'Reached' }, { key: 'currentlyHere', label: 'Currently here' }], layout: 'vertical', title: 'Leads reaching each stage' }],
  agents: [{ kind: 'bar', data: 'agents', x: 'agent', keys: [{ key: 'leads', label: 'Leads' }, { key: 'won', label: 'Won' }], title: 'Leads and wins by person' }],
  response: [{ kind: 'area', data: 'trend', x: 'date', keys: [{ key: 'medianMinutes', label: 'Median minutes to first reply' }], title: 'Median first-response time' }],
  appointments: [{ kind: 'bar', data: 'trend', x: 'date', keys: [{ key: 'booked', label: 'Scheduled' }, { key: 'completed', label: 'Completed' }], title: 'Appointments per day' }],
  ai: [{ kind: 'area', data: 'trend', x: 'date', keys: [{ key: 'runs', label: 'AI turns' }], title: 'AI turns per day' }, { kind: 'bar', data: 'outcomes', x: 'outcome', keys: [{ key: 'count', label: 'Turns' }], layout: 'vertical', title: 'Turn outcomes' }],
  automations: [{ kind: 'bar', data: 'trend', x: 'date', keys: [{ key: 'succeeded', label: 'Succeeded' }, { key: 'failed', label: 'Failed' }], title: 'Automation runs per day' }],
};

const LABELS: Record<string, [string, string]> = {
  totalLeads: ['Leads', ''], previousPeriod: ['Previous period', ''], changePct: ['Change', '%'], qualified: ['Qualified', ''], won: ['Won', ''], conversionPct: ['Conversion', '%'],
  cohort: ['Leads in period', ''], lost: ['Lost', ''], winRatePct: ['Win rate', '%'], lossRatePct: ['Loss rate', '%'], agents: ['People', ''], leads: ['Leads', ''],
  conversations: ['Conversations', ''], answered: ['Answered', ''], unanswered: ['Unanswered', ''], medianMinutes: ['Median reply', ' min'], p90Minutes: ['90th percentile', ' min'], targetMinutes: ['Target', ' min'], withinTargetPct: ['Within target', '%'], slaBreaches: ['SLA breaches', ''],
  total: ['Appointments', ''], completed: ['Completed', ''], noShow: ['No-shows', ''], cancelled: ['Cancelled', ''], upcomingOrPending: ['Upcoming / pending', ''], showRatePct: ['Show rate', '%'], cancellationRatePct: ['Cancellation rate', '%'],
  aiTurns: ['AI turns', ''], conversationsHandled: ['Conversations', ''], handoverRatePct: ['Handover rate', '%'], handovers: ['Handovers', ''], skipped: ['Skipped', ''], failed: ['Failed', ''], inputTokens: ['Input tokens', ''], outputTokens: ['Output tokens', ''], avgLatencyMs: ['Avg latency', ' ms'], p95LatencyMs: ['p95 latency', ' ms'], repliesBlockedByGuards: ['Replies caught by guards', ''],
  activeAutomations: ['Active automations', ''], runs: ['Runs', ''], succeeded: ['Succeeded', ''], successRatePct: ['Success rate', '%'],
};

function Chart({ spec: rawSpec, data }: { spec: ChartSpec; data: Record<string, string | number | null>[] }) {
  const reduce = useReducedMotion();
  const terms = useTerms();
  const spec: ChartSpec = { ...rawSpec, title: applyTerms(rawSpec.title, terms), keys: rawSpec.keys.map((k) => ({ ...k, label: applyTerms(k.label, terms) })) };
  if (!data?.length) return <p className="text-helper py-10 text-center">Nothing in this period.</p>;
  const vertical = spec.layout === 'vertical';
  return (
    <div className="h-64" role="img" aria-label={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        {spec.kind === 'area' ? (
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={spec.x} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} allowDecimals={false} />
            <ChartTooltip contentStyle={tooltipStyle} />
            {spec.keys.map((k, i) => <Area key={k.key} type="monotone" dataKey={k.key} name={k.label} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.15} strokeWidth={2} connectNulls isAnimationActive={!reduce} />)}
          </AreaChart>
        ) : (
          <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 12, left: vertical ? 24 : -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={!vertical} vertical={vertical} />
            {vertical ? <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} allowDecimals={false} /> : <XAxis dataKey={spec.x} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} minTickGap={16} />}
            {vertical ? <YAxis type="category" dataKey={spec.x} width={120} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} /> : <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} allowDecimals={false} />}
            <ChartTooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
            {spec.keys.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {spec.keys.map((k, i) => <Bar key={k.key} dataKey={k.key} name={k.label} fill={COLORS[i]} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={!reduce} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default function ReportsPage() {
  const { ctx } = useAuth();
  const terms = useTerms();
  const T = (x: string) => applyTerms(x, terms);
  const manager = ctx.permissions.includes('analytics:read:all') || ctx.permissions.includes('analytics:read:team');
  const visible = REPORTS.filter((r) => manager || !('managerOnly' in r));
  const [key, setKey] = useState<ReportKey>('acquisition');
  const [range, setRange] = useState<RangeKey>('30d');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const customReady = range !== 'custom' || (from !== '' && to !== '' && from <= to);
  const query = reportQuery(range, from, to);
  const q = useQuery({ queryKey: ['report', key, query], queryFn: () => api<ReportData>(`/reports/${key}?${query}`), enabled: customReady });
  const plan = useQuery({ queryKey: ['billing-summary'], queryFn: () => api<BillingSummary>('/billing/summary'), staleTime: 60_000 });
  const canExport = plan.data?.features.csv_export ?? false;
  const meta = REPORTS.find((r) => r.key === key);

  async function exportTable(table: string) {
    setExporting(table);
    try { await downloadReportCsv(key, query, table); toast.success('CSV downloaded'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(null); }
  }

  return (
    <>
      <PageHeader title="Reports" description={T(meta?.blurb ?? '')} actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="w-40">{RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>
          {range === 'custom' ? <><Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /><Input aria-label="To date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" /></> : null}
        </div>
      )} />
      <div role="tablist" aria-label="Reports" className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {visible.map((r) => <button key={r.key} role="tab" aria-selected={key === r.key} onClick={() => setKey(r.key)} className={cn('relative px-3 py-2.5 text-[13px] font-medium', key === r.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>{T(r.label)}{key === r.key ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}</button>)}
      </div>

      {!customReady ? <Card><EmptyState icon={BarChart3} title="Choose a start and end date" description="Pick both dates for a custom range." /></Card>
        : q.isPending ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2 shadow-xs">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3.5 w-24" />
              </CardHeader>
              <CardBody className="h-64 flex items-end gap-3 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <div
                      className="w-full rounded-t bg-muted/60 skeleton"
                      style={{ height: `${25 + ((i * 10) % 70)}%` }}
                    />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        )
        : q.isError ? <Card><EmptyState icon={BarChart3} title="Could not load this report" description={q.error instanceof Error ? q.error.message : 'Please try again.'} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /></Card>
        : (
          <div className="space-y-4">
            <p className="text-helper">{q.data.range.label}, {new Date(q.data.range.from).toLocaleDateString('en-IN', { timeZone: q.data.range.timezone })} to {new Date(new Date(q.data.range.to).getTime() - 1).toLocaleDateString('en-IN', { timeZone: q.data.range.timezone })} ({q.data.range.timezone}){q.data.scope === 'own' ? ' · only your own leads and conversations' : ''}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(q.data.summary).map(([k, v]) => { const [rawLabel, suffix] = LABELS[k] ?? [k, '']; const label = T(rawLabel); return <div key={k} className="rounded-lg border border-border bg-card p-3.5 shadow-sm"><p className="text-[12px] font-medium text-muted-foreground">{label}</p><p className="num mt-1.5 text-[22px] font-semibold leading-none">{fmt(v, suffix)}</p></div>; })}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {CHARTS[key].map((c) => <Card key={c.title}><CardHeader><CardTitle>{T(c.title)}</CardTitle></CardHeader><CardBody><Chart spec={c} data={q.data.series[c.data] ?? []} /></CardBody></Card>)}
            </div>
            {q.data.tables.map((t) => (
              <Card key={t.name}>
                <CardHeader>
                  <CardTitle>{t.title}</CardTitle>
                  <Button size="sm" onClick={() => void exportTable(t.name)} disabled={!canExport || exporting === t.name} title={canExport ? 'Download as CSV' : 'CSV export is not included in your plan'} aria-label={`Export ${t.title} as CSV`}><Download className="h-3.5 w-3.5" aria-hidden /> {canExport ? 'Export CSV' : 'Export (upgrade)'}</Button>
                </CardHeader>
                <CardBody className="overflow-x-auto p-0">
                  {t.rows.length === 0 ? <p className="text-helper px-4 py-6">No rows in this period.</p> : (
                    <table className="w-full text-[13px]"><thead><tr className="border-b border-border text-left text-[12px] text-muted-foreground">{t.columns.map((c) => <th key={c.key} scope="col" className="px-4 py-2 font-medium">{c.label}</th>)}</tr></thead>
                      <tbody>{t.rows.map((r, i) => <tr key={i} className="border-b border-border last:border-0">{t.columns.map((c, j) => <td key={c.key} className={cn('px-4 py-2', j > 0 && 'num')}>{fmt(r[c.key] as string | number | null)}</td>)}</tr>)}</tbody></table>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
    </>
  );
}
