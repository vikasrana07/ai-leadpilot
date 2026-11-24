'use client';

import type { OnboardingProgress } from '@leadpilot/validation';
import { ONBOARDING_STEPS } from '@leadpilot/validation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, Circle, Flame, Plus } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { LeadFormDialog } from '@/components/crm/lead-form-dialog';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { DashboardContentSkeleton } from '@/components/skeletons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/pack';
import { cn } from '@/lib/cn';
import { qs } from '@/lib/crm';
import { timeAgo } from '@/lib/format';

interface Kpi { value: number; deltaPct: number | null }
interface Overview {
  range: { label: string; from: string; to: string; timezone: string };
  kpis: { totalLeads: Kpi; newLeads: Kpi; qualifiedLeads: Kpi; hotLeads: Kpi; converted: Kpi; conversionRate: Kpi };
  trend: { date: string; leads: number }[];
  sources: { name: string; leads: number; won: number }[];
  pipeline: { stage: string; kind: string; count: number }[];
  agents: { membershipId: string | null; name: string; openLeads: number }[];
  recentLeads: { id: string; name: string; createdAt: string; stage: string; source: string | null; temperature: string }[];
  hotLeads: { id: string; name: string; score: number | null; stage: string; lastContactedAt: string | null; nextFollowUpAt: string | null }[];
  upcomingFollowUps: { id: string; name: string; at: string | null }[];
  notAvailableYet: string[];
}

const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['custom', 'Custom']] as const;
const labelsFor = (lead: string): Record<string, string> => ({ business: 'Business details', industry: 'Industry', team: 'Invite your team', whatsapp: 'Connect WhatsApp', assistant: 'Configure the AI assistant', knowledge: 'Upload knowledge documents', qualification: `${lead.charAt(0).toUpperCase()}${lead.slice(1)} qualification rules` });
const axis = { tick: { fill: 'var(--muted-foreground)', fontSize: 11 }, axisLine: false, tickLine: false } as const;
const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)', boxShadow: 'var(--shadow-md)' };

function SetupCard() {
  const terms = useTerms();
  const labels = labelsFor(terms.lead);
  const onboarding = useQuery({ queryKey: ['tenant', 'onboarding'], queryFn: () => api<OnboardingProgress>('/tenant/onboarding') });
  const steps = ONBOARDING_STEPS.filter((s) => s !== 'complete');
  const done = new Set([...(onboarding.data?.completed ?? []), ...(onboarding.data?.skipped ?? [])]);
  if (!onboarding.data || onboarding.data.step === 'complete') return null;
  return (
    <Card className="mb-4">
      <CardHeader><div><CardTitle>Finish setting up</CardTitle><p className="text-helper mt-0.5">{done.size} of {steps.length} steps done</p></div><Button asChild variant="primary" size="sm"><Link href="/onboarding">Continue setup <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button></CardHeader>
      <CardBody><ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{steps.map((s) => <li key={s} className="flex items-center gap-2 text-[13px]">{done.has(s) ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4 text-border-strong" aria-hidden />}<span className={done.has(s) ? 'text-muted-foreground line-through' : ''}>{labels[s]}</span></li>)}</ul></CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const { ctx, activeWorkspace, can } = useAuth();
  const terms = useTerms();
  const reduce = useReducedMotion();
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('30d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [addOpen, setAddOpen] = useState(false);
  const customReady = range !== 'custom' || (custom.from !== '' && custom.to !== '' && custom.from <= custom.to);
  const params = range === 'custom' ? { range, from: custom.from ? new Date(`${custom.from}T12:00:00`).toISOString() : '', to: custom.to ? new Date(`${custom.to}T12:00:00`).toISOString() : '' } : { range };
  const q = useQuery({ queryKey: ['analytics', 'overview', params], enabled: customReady, queryFn: () => api<Overview>(`/analytics/overview${qs(params)}`), placeholderData: (p) => p });
  const d = q.data;
  const noData = d !== undefined && d.kpis.totalLeads.value === 0;

  return (
    <>
      <PageHeader title={`Welcome, ${ctx.user.name.split(' ')[0]}`} description={`${activeWorkspace?.name ?? 'Your workspace'}${d ? ` · ${d.range.label}` : ''}`} actions={can('lead:write:all') || can('lead:write:own') ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden />Add {terms.lead}</Button> : undefined} />
      <SetupCard />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {RANGES.map(([k, label]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)} className={cn('min-h-9 rounded-full px-3 py-1 text-[12px] font-medium transition-colors lg:min-h-0', range === k ? 'bg-primary text-primary-foreground' : 'border border-border bg-surface text-muted-foreground hover:bg-muted')}>{label}</button>)}
        {range === 'custom' ? <><Input aria-label="From date" type="date" className="h-8 w-auto" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /><Input aria-label="To date" type="date" className="h-8 w-auto" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></> : null}
      </div>

      {!customReady ? <Card><EmptyState icon={CalendarClock} title="Choose a date range" description="Pick a start and end date to see this period." /></Card> : q.isPending ? (
        <DashboardContentSkeleton />
      ) : q.isError || !d ? <Card><EmptyState icon={CalendarClock} title="Could not load your dashboard" description="Check your connection and try again." action={<Button onClick={() => void q.refetch()}>Retry</Button>} /></Card> : (
        <div className={cn('space-y-4 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <KpiCard label={`Total ${terms.leads}`} value={d.kpis.totalLeads.value} deltaPct={null} hint={`All active ${terms.leads}`} />
            <KpiCard label={`New ${terms.leads}`} value={d.kpis.newLeads.value} deltaPct={d.kpis.newLeads.deltaPct} trend={d.trend.map((t) => t.leads)} hint="No earlier period yet" />
            <KpiCard label="Qualified" value={d.kpis.qualifiedLeads.value} deltaPct={d.kpis.qualifiedLeads.deltaPct} hint={`Of ${terms.leads} added in range`} />
            <KpiCard label={`Hot ${terms.leads}`} value={d.kpis.hotLeads.value} deltaPct={null} hint="Open, right now" />
            <KpiCard label="Converted" value={d.kpis.converted.value} deltaPct={d.kpis.converted.deltaPct} hint="Won in this range" />
            <KpiCard label="Conversion rate" value={d.kpis.conversionRate.value} suffix="%" deltaPct={d.kpis.conversionRate.deltaPct} hint="Won ÷ added" />
          </div>
          <p className="text-helper">Appointments, AI conversations and automation stats appear here when those modules ship.</p>

          {noData ? <Card><EmptyState icon={Plus} title={`No ${terms.leads} yet`} description={`Add ${terms.aLead}, import a CSV, or connect a lead source. Your numbers show up here as soon as ${terms.leads} arrive.`} action={<Button variant="primary" onClick={() => setAddOpen(true)}>Add {terms.lead}</Button>} /></Card> : (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
                <Card>
                  <CardHeader><CardTitle>{terms.Lead} acquisition</CardTitle><span className="text-helper">{d.range.timezone}</span></CardHeader>
                  <CardBody className="h-64">
                    <ResponsiveContainer width="100%" height="100%"><AreaChart data={d.trend} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <defs><linearGradient id="fillLeads" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="date" {...axis} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} /><YAxis {...axis} allowDecimals={false} />
                      <ChartTooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--border-strong)' }} formatter={(v) => [v, terms.Leads]} />
                      <Area type="monotone" dataKey="leads" stroke="var(--chart-1)" strokeWidth={2} fill="url(#fillLeads)" isAnimationActive={!reduce} animationDuration={700} />
                    </AreaChart></ResponsiveContainer>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Pipeline</CardTitle><span className="text-helper">{terms.Leads} by stage</span></CardHeader>
                  <CardBody className="h-64">
                    <ResponsiveContainer width="100%" height="100%"><BarChart data={d.pipeline} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide /><YAxis type="category" dataKey="stage" width={118} {...axis} />
                      <ChartTooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} formatter={(v) => [v, terms.Leads]} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={!reduce}>{d.pipeline.map((p) => <Cell key={p.stage} fill={p.kind === 'WON' ? 'var(--success)' : p.kind === 'LOST' ? 'var(--danger)' : 'var(--chart-1)'} />)}</Bar>
                    </BarChart></ResponsiveContainer>
                  </CardBody>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <Card>
                  <CardHeader><CardTitle><Flame className="mr-1.5 inline h-4 w-4 text-danger" aria-hidden />Hot {terms.leads} needing attention</CardTitle></CardHeader>
                  {d.hotLeads.length === 0 ? <p className="text-helper p-4">No hot open {terms.leads} right now.</p> : <ul className="divide-y divide-border">{d.hotLeads.map((h) => <li key={h.id}><Link href={`/leads/${h.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40"><Avatar name={h.name} size={28} /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{h.name}</span><span className="text-helper">{h.stage} · contacted {timeAgo(h.lastContactedAt)}</span></span>{h.score !== null ? <Badge tone="danger" className="num">{h.score}</Badge> : null}</Link></li>)}</ul>}
                </Card>
                <Card>
                  <CardHeader><CardTitle>Upcoming follow-ups</CardTitle></CardHeader>
                  {d.upcomingFollowUps.length === 0 ? <p className="text-helper p-4">Nothing scheduled in the next 7 days.</p> : <ul className="divide-y divide-border">{d.upcomingFollowUps.map((f) => <li key={f.id}><Link href={`/leads/${f.id}`} className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-muted/40"><span className="font-medium">{f.name}</span><span className="num text-muted-foreground">{f.at ? new Date(f.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span></Link></li>)}</ul>}
                </Card>
                <Card>
                  <CardHeader><CardTitle>{terms.Lead} sources</CardTitle></CardHeader>
                  {d.sources.length === 0 ? <p className="text-helper p-4">No {terms.leads} in this period.</p> : <table className="w-full text-[13px]"><thead className="text-label text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Source</th><th className="px-4 py-2 text-right font-medium">{terms.Leads}</th><th className="px-4 py-2 text-right font-medium">Won</th></tr></thead><tbody className="divide-y divide-border">{d.sources.map((s) => <tr key={s.name}><td className="px-4 py-2">{s.name}</td><td className="num px-4 py-2 text-right">{s.leads}</td><td className="num px-4 py-2 text-right">{s.won}</td></tr>)}</tbody></table>}
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Recent {terms.leads}</CardTitle><Button asChild variant="link"><Link href="/leads">View all</Link></Button></CardHeader>
                  <ul className="divide-y divide-border">{d.recentLeads.map((l) => <li key={l.id}><Link href={`/leads/${l.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40"><Avatar name={l.name} size={28} /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{l.name}</span><span className="text-helper">{l.source ?? 'Unknown source'} · {timeAgo(l.createdAt)}</span></span><Badge tone="primary">{l.stage}</Badge></Link></li>)}</ul>
                </Card>
                {d.agents.length > 0 ? (
                  <Card>
                    <CardHeader><CardTitle>Open {terms.leads} by agent</CardTitle></CardHeader>
                    <table className="w-full text-[13px]"><tbody className="divide-y divide-border">{d.agents.map((a) => <tr key={a.membershipId ?? 'none'}><td className="px-4 py-2"><span className="flex items-center gap-2.5"><Avatar name={a.name} size={24} />{a.name}</span></td><td className="num px-4 py-2 text-right font-medium">{a.openLeads}</td></tr>)}</tbody></table>
                  </Card>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
