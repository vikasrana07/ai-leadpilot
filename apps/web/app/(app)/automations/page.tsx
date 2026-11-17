'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, Network, Pencil, Play, Plus, RotateCcw, Trash2, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs } from '@/lib/crm';
import { handleApiError } from '@/lib/forms';
import { ACTION_LABELS, describeTrigger, type AutomationItem, type AutomationRun, type AutomationTemplate } from '@/lib/ops';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

const RUN_TONE = { QUEUED: 'neutral', RUNNING: 'primary', WAITING: 'primary', SUCCEEDED: 'success', FAILED: 'danger', SKIPPED: 'warning', DRY_RUN: 'neutral' } as const;
const STEP_TONE = { done: 'success', skipped: 'warning', failed: 'danger', preview: 'neutral' } as const;
const GATE_TEXT: Record<string, string> = { conditions_not_met: 'Conditions were not met', cooldown: 'Ran recently for this lead (cooldown)', loop_protection: 'Stopped to prevent a loop', no_lead: 'The lead no longer exists' };

function DryRunDialog({ automation, onClose }: { automation: AutomationItem; onClose: () => void }) {
  const [search, setSearch] = useState(''); const q = useDebounce(search, 250);
  const leads = useQuery({ queryKey: ['leads', 'picker', q], queryFn: () => api<{ items: { id: string; name: string; phone: string | null }[] }>(`/leads${qs({ q, pageSize: 6 })}`) });
  const [result, setResult] = useState<{ conditionsMet: boolean; steps: { i: number; type: string; status: keyof typeof STEP_TONE; detail?: string }[]; context: { lead: string; stage: string; temperature: string } } | null>(null);
  const run = useMutation({ mutationFn: (leadId: string) => api<NonNullable<typeof result>>(`/automations/${automation.id}/dry-run`, { method: 'POST', body: { leadId } }), onSuccess: setResult, onError: (e) => handleApiError(e) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Test “${automation.name}”`} className="max-w-xl">
        <p className="text-helper mb-3">Pick a real lead to see what this automation would do. Nothing is sent, assigned or created.</p>
        <Field label="Lead" htmlFor="dr-lead"><Input id="dr-lead" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        <div className="mt-1 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">{(leads.data?.items ?? []).map((l) => <button key={l.id} type="button" className="flex w-full justify-between px-3 py-2 text-left text-[13px] hover:bg-muted" onClick={() => run.mutate(l.id)}><span>{l.name}</span><span className="text-helper">{l.phone}</span></button>)}</div>
        {run.isPending ? <Skeleton className="mt-3 h-20" /> : null}
        {result ? <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-[13px]">
          <p className="font-medium">{result.context.lead} · {result.context.stage} · {result.context.temperature.toLowerCase()}</p>
          {!result.conditionsMet ? <p className="text-warning">Conditions are not met for this lead, so nothing would run.</p> : result.steps.map((s) => <div key={s.i} className="flex items-start gap-2"><Badge tone={STEP_TONE[s.status]}>{s.status === 'preview' ? 'Would run' : s.status === 'skipped' ? 'Would skip' : s.status}</Badge><span>{s.detail}</span></div>)}</div> : null}
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function RunsPanel() {
  const qc = useQueryClient(); const [status, setStatus] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ['automations', 'runs', status], queryFn: () => api<{ items: AutomationRun[] }>(`/automations/runs${qs({ status: status || undefined, limit: 40 })}`), refetchInterval: 8000 });
  const retry = useMutation({ mutationFn: (id: string) => api(`/automations/runs/${id}/retry`, { method: 'POST' }), onSuccess: async () => { toast.success('Queued again'); await qc.invalidateQueries({ queryKey: ['automations'] }); }, onError: (e) => handleApiError(e) });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3"><h2 className="text-heading">Run history</h2>
        <select aria-label="Status" className="ml-auto h-8 rounded-md border border-border bg-surface px-2 text-[12px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['SUCCEEDED', 'FAILED', 'SKIPPED', 'DRY_RUN', 'QUEUED', 'WAITING'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}</select></div>
      {runs.isPending ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : runs.data?.items.length === 0 ? <EmptyState icon={Workflow} title="Nothing has run yet" description="Runs appear here as soon as an enabled automation reacts to something." /> : (
        <div className="divide-y divide-border">{runs.data?.items.map((r) => (
          <div key={r.id} className="px-4 py-2.5 text-[13px]">
            <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <Badge tone={RUN_TONE[r.status]}>{r.status.replace('_', ' ').toLowerCase()}</Badge><span className="font-medium">{r.automationName}</span><span className="text-muted-foreground">{r.leadName ?? ''}</span><span className="text-helper ml-auto">{timeAgo(r.createdAt)}{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}</span></button>
            {open === r.id ? <div className="mt-2 space-y-1 pl-1">
              {r.steps.length === 0 ? <p className="text-helper">No steps recorded yet.</p> : r.steps.map((s, i) => <p key={i} className="flex items-start gap-2"><Badge tone={s.status in STEP_TONE ? STEP_TONE[s.status as keyof typeof STEP_TONE] : 'neutral'}>{s.type === 'gate' ? 'skipped' : s.status}</Badge><span>{s.type === 'gate' ? GATE_TEXT[s.detail ?? ''] ?? s.detail : `${ACTION_LABELS[s.type] ?? s.type}${s.detail ? `: ${s.detail}` : ''}`}</span></p>)}
              {r.error ? <p className="text-danger"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />{r.error}</p> : null}
              {(r.steps as { nodeId?: string }[]).some((x) => x.nodeId) ? <Button size="sm" asChild><Link href={`/automations/${r.automationId}/edit?run=${r.id}`} aria-label={`View this ${r.automationName} run on the canvas`}><Network className="h-3.5 w-3.5" aria-hidden />View on canvas</Link></Button> : null}
              {r.status === 'FAILED' ? <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate(r.id)}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Retry failed steps</Button> : null}</div> : null}
          </div>))}</div>)}
    </Card>
  );
}

export default function AutomationsPage() {
  const { can } = useAuth(); const qc = useQueryClient(); const router = useRouter(); const allowed = can('automation:manage');
  const [tab, setTab] = useState<'mine' | 'gallery' | 'history'>('mine'); const [dry, setDry] = useState<AutomationItem | null>(null); const [del, setDel] = useState<AutomationItem | null>(null);
  const list = useQuery({ queryKey: ['automations', 'list'], enabled: allowed, queryFn: () => api<{ items: AutomationItem[] }>('/automations') });
  const templates = useQuery({ queryKey: ['automations', 'templates'], enabled: allowed, queryFn: () => api<{ items: AutomationTemplate[] }>('/automations/templates') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['automations'] });
  const toggle = useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => api(`/automations/${v.id}/enable`, { method: 'POST', body: { enabled: v.enabled } }), onSuccess: refresh, onError: (e) => handleApiError(e) });
  const install = useMutation({ mutationFn: (key: string) => api('/automations/from-template', { method: 'POST', body: { templateKey: key } }), onSuccess: async () => { toast.success('Added. It is switched off until you enable it.'); await refresh(); setTab('mine'); }, onError: (e) => handleApiError(e) });
  const customize = useMutation({
    mutationFn: async (t: AutomationTemplate) => {
      const existing = list.data?.items.find((a) => a.templateKey === t.key);
      return existing ?? (await api<AutomationItem>('/automations/from-template', { method: 'POST', body: { templateKey: t.key } }));
    },
    onSuccess: async (a) => { await refresh(); router.push(`/automations/${a.id}/edit`); },
    onError: (e) => handleApiError(e),
  });
  if (!allowed) return <><PageHeader title="Automations" /><Card><EmptyState icon={Workflow} title="You do not have access" description="Ask a workspace owner or manager for the automations permission." /></Card></>;
  const tabs = [['mine', 'My automations'], ['gallery', 'Templates'], ['history', 'Run history']] as const;
  return (
    <>
      <PageHeader title="Automations" description="Follow-ups and alerts that run on their own. Every run is recorded, retried on failure, and can be tested first."
        actions={<Button asChild variant="primary"><Link href="/automations/new"><Plus className="h-4 w-4" aria-hidden />New automation</Link></Button>} />
      <div role="tablist" aria-label="Automations" className="mb-3 flex gap-1 border-b border-border">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium', tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{l}</button>)}</div>
      {tab === 'history' ? <RunsPanel /> : tab === 'gallery' ? (
        templates.isPending ? <Skeleton className="h-48" /> : <div className="grid gap-3 md:grid-cols-2">{templates.data?.items.map((t) => (
          <Card key={t.key} className="flex flex-col p-4"><div className="flex items-start justify-between gap-2"><div><Badge>{t.category}</Badge><h3 className="text-heading mt-1.5">{t.name}</h3></div><div className="flex shrink-0 items-center gap-1.5">{t.installed ? <Badge tone="success">Added</Badge> : <Button size="sm" variant="primary" loading={install.isPending && install.variables === t.key} onClick={() => install.mutate(t.key)}>Add</Button>}<Button size="sm" loading={customize.isPending && customize.variables?.key === t.key} onClick={() => customize.mutate(t)} aria-label={`Customize ${t.name} in the editor`}><Pencil className="h-3.5 w-3.5" aria-hidden />Customize</Button></div></div>
            <p className="text-helper mt-1.5">{t.description}</p><p className="mt-2 text-[12px]"><span className="text-muted-foreground">When:</span> {describeTrigger(t.trigger)}</p>
            <p className="text-[12px]"><span className="text-muted-foreground">Then:</span> {t.actions.map((a) => ACTION_LABELS[a.type] ?? a.type).join(', ')}</p>
            {t.requiresWhatsappTemplates.length ? <p className="text-helper mt-1.5">Needs WhatsApp template{t.requiresWhatsappTemplates.length > 1 ? 's' : ''}: {t.requiresWhatsappTemplates.map((n) => <code key={n} className="mx-0.5 rounded bg-muted px-1">{n}</code>)}</p> : null}</Card>))}</div>
      ) : list.isPending ? <Skeleton className="h-48" /> : list.data?.items.length === 0 ? (
        <Card><EmptyState icon={Workflow} title="No automations yet" description="Start from a template: welcome messages, visit reminders, hot-lead alerts and more." action={<Button variant="primary" onClick={() => setTab('gallery')}>Browse templates</Button>} /></Card>
      ) : <div className="space-y-2">{list.data?.items.map((a) => (
        <Card key={a.id} className="p-4"><div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-heading">{a.name}</h3><Badge tone={a.enabled ? 'success' : 'neutral'}>{a.enabled ? 'On' : 'Off'}</Badge>{a.graph.nodes.some((n) => n.type === 'branch' || n.type === 'wait') ? <Badge>Branches or waits</Badge> : null}</div>
            <p className="mt-1 text-[12px]"><span className="text-muted-foreground">When:</span> {describeTrigger(a.trigger)}{a.conditions.length ? ` · only if ${a.conditions.length} condition${a.conditions.length > 1 ? 's' : ''} match` : ''}</p>
            <p className="text-[12px]"><span className="text-muted-foreground">Then:</span> {a.actions.map((x) => ACTION_LABELS[x.type] ?? x.type).join(' → ')}</p>
            {a.missingWhatsappTemplates.length ? <p className="mt-1 text-[12px] text-warning"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />WhatsApp template not registered: {a.missingWhatsappTemplates.join(', ')}. Message steps will be skipped until you add it in Integrations.</p> : null}
            <p className="text-helper mt-1">Last 7 days: {a.last7Days.succeeded} ran · {a.last7Days.skipped} skipped · {a.last7Days.failed} failed</p></div>
          <div className="flex items-center gap-1.5"><Button size="sm" asChild><Link href={`/automations/${a.id}/edit`} aria-label={`Edit ${a.name}`}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Link></Button><Button size="sm" onClick={() => setDry(a)}><FlaskConical className="h-3.5 w-3.5" aria-hidden />Test</Button><Button size="sm" variant={a.enabled ? 'secondary' : 'primary'} loading={toggle.isPending && toggle.variables?.id === a.id} onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })}><Play className="h-3.5 w-3.5" aria-hidden />{a.enabled ? 'Turn off' : 'Turn on'}</Button><Button size="icon" variant="ghost" aria-label={`Delete ${a.name}`} onClick={() => setDel(a)}><Trash2 className="h-3.5 w-3.5" /></Button></div>
        </div></Card>))}</div>}
      {dry ? <DryRunDialog automation={dry} onClose={() => setDry(null)} /> : null}
      <ConfirmDialog open={del !== null} onOpenChange={(o) => { if (!o) setDel(null); }} danger title={`Delete “${del?.name ?? ''}”?`} description="Its run history is deleted too." confirmLabel="Delete" onConfirm={async () => { if (!del) return; try { await api(`/automations/${del.id}`, { method: 'DELETE' }); toast.success('Deleted'); await refresh(); } catch (e) { handleApiError(e); throw e; } }} />
    </>
  );
}
