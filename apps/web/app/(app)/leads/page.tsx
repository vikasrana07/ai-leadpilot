'use client';

import type { LeadDto, PagedResult } from '@leadpilot/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Plus, Search, Upload, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ImportDialog } from '@/components/crm/import-dialog';
import { LeadFormDialog } from '@/components/crm/lead-form-dialog';
import { StageBadge, TemperatureBadge } from '@/components/crm/lead-badges';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { API_URL, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { qs, useLeadMeta, useMembers, useStages } from '@/lib/crm';
import { formatBudget, timeAgo } from '@/lib/format';
import { usePack, useTerms } from '@/lib/pack';
import { t } from '@/lib/i18n';

type SortKey = 'createdAt' | 'name' | 'score' | 'nextFollowUpAt';
type BulkBody = { action: 'assign'; assignedMembershipId: string | null } | { action: 'stage'; stageId: string; lostReasonId?: string } | { action: 'tag'; add: string[]; remove: string[] } | { action: 'delete' };

export default function LeadsPage() {
  const { can } = useAuth();
  const lf = usePack().leadFields;
  const terms = useTerms();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const [f, setF] = useState({ stageId: '', temperature: '', assigned: '', sourceId: '', kind: '', overdue: '' });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const stages = useStages(); const meta = useLeadMeta(); const members = useMembers();
  const params = { q, stageId: f.stageId, temperature: f.temperature, assigned: f.assigned, sourceId: f.sourceId, kind: f.kind, overdue: f.overdue, sort: sort.key, dir: sort.dir };
  const leads = useQuery({ queryKey: ['leads', 'list', params, page], queryFn: () => api<PagedResult<LeadDto>>(`/leads${qs({ ...params, page, pageSize: 25 })}`), placeholderData: (prev) => prev });
  const canWriteAll = can('lead:write:all');
  const items = leads.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const filtered = Object.values(f).some(Boolean) || q !== '';

  const bulk = useMutation({
    mutationFn: (b: BulkBody) => api<{ updated: number; skipped: { id: string; reason: string }[] }>('/leads/bulk', { method: 'POST', body: { ...b, ids: [...selected] } }),
    onSuccess: (r) => {
      toast[r.skipped.length ? 'warning' : 'success'](`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped: ${r.skipped[0]?.reason}` : ''}`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['leads'] }); void qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Bulk action failed'),
  });

  async function exportCsv() {
    const res = await fetch(`${API_URL}/leads/export${qs({ ...params })}`, { credentials: 'include' });
    if (!res.ok) { toast.error('Export failed'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const th = (label: string, key?: SortKey, cls = '') => (
    <th scope="col" className={cn('px-3 py-2.5 font-medium', cls)} aria-sort={key && sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {key ? <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>{label}{sort.key === key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : null}</button> : label}
    </th>
  );
  const sel = (key: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [key]: e.target.value })); setPage(1); };

  return (
    <>
      <PageHeader title={terms.Leads} description="Every enquiry, scored and assigned." actions={<>
        {can('lead:import') ? <Button onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" aria-hidden />{t('leads.import')}</Button> : null}
        {can('lead:export') ? <Button onClick={() => void exportCsv()}><Download className="h-4 w-4" aria-hidden />{t('leads.export')}</Button> : null}
        {can('lead:write:all') || can('lead:write:own') ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden />Add {terms.lead}</Button> : null}
      </>} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input aria-label={`Search ${terms.leads}`} placeholder="Search name, phone, email" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select aria-label="Stage" className="w-auto" value={f.stageId} onChange={sel('stageId')}><option value="">All stages</option>{stages.data?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select aria-label="Temperature" className="w-auto" value={f.temperature} onChange={sel('temperature')}><option value="">Any temperature</option><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option><option value="UNKNOWN">Unscored</option></Select>
          {canWriteAll ? <Select aria-label="Assigned to" className="w-auto" value={f.assigned} onChange={sel('assigned')}><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>{members.data?.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select> : null}
          <Select aria-label="Source" className="w-auto" value={f.sourceId} onChange={sel('sourceId')}><option value="">All sources</option>{meta.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><input type="checkbox" checked={f.overdue === 'true'} onChange={(e) => { setF((s) => ({ ...s, overdue: e.target.checked ? 'true' : '' })); setPage(1); }} />Follow-up overdue</label>
          {filtered ? <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setF({ stageId: '', temperature: '', assigned: '', sourceId: '', kind: '', overdue: '' }); setPage(1); }}>Clear</Button> : null}
        </div>

        {selected.size > 0 ? (
          <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-3 py-2 text-[13px]">
            <span className="num font-medium">{selected.size} selected</span>
            {can('lead:assign') ? <Select aria-label="Assign selected to" className="w-auto" value="" onChange={(e) => { if (e.target.value) bulk.mutate({ action: 'assign', assignedMembershipId: e.target.value === 'none' ? null : e.target.value }); }}><option value="">Assign to…</option><option value="none">Unassigned</option>{members.data?.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select> : null}
            <Select aria-label="Move selected to stage" className="w-auto" value="" onChange={(e) => { const s = stages.data?.stages.find((x) => x.id === e.target.value); if (s && s.kind !== 'LOST') bulk.mutate({ action: 'stage', stageId: s.id }); else if (s) toast.info('Open each lead to record why it was lost'); }}><option value="">Move to stage…</option>{stages.data?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            {can('lead:delete') ? <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>Delete</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        ) : null}

        {leads.isPending ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11" />)}</div> : leads.isError ? (
          <EmptyState icon={Users} title={`Could not load ${terms.leads}`} description="Check your connection and try again." action={<Button onClick={() => void leads.refetch()}>Retry</Button>} />
        ) : items.length === 0 ? (
          <EmptyState icon={Users} title={filtered ? `No ${terms.leads} match these filters` : `No ${terms.leads} yet`} description={filtered ? 'Try clearing a filter or searching for something else.' : `Add your first ${terms.lead}, import a CSV, or connect a lead source.`} action={!filtered && (can('lead:write:all') || can('lead:write:own')) ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden />Add {terms.lead}</Button> : undefined} />
        ) : (
          <div className={cn(leads.isPlaceholderData && 'opacity-60 transition-opacity')}>
            <ul className="divide-y divide-border md:hidden" aria-label={terms.Leads}>
              {items.map((l) => (
                <li key={l.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <input type="checkbox" className="mt-1" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />
                    <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className="truncate text-[14px] font-medium">{l.name}</span><TemperatureBadge value={l.temperature} /></span>
                      <span className="text-helper block truncate">{l.phone ?? l.email}{l.location ? ` · ${l.location}` : ''}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2"><StageBadge name={l.stage.name} kind={l.stage.kind} />{lf.budget ? <span className="num text-[12px] text-muted-foreground">{formatBudget(l.budgetMin, l.budgetMax)}</span> : null}</span>
                      <span className="text-helper mt-1.5 block">{l.assignee ? l.assignee.name : 'Unassigned'} · added {timeAgo(l.createdAt)}{l.nextFollowUpAt && l.stage.kind === 'OPEN' ? ` · follow-up ${timeAgo(l.nextFollowUpAt)}` : ''}</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-xs text-label text-muted-foreground shadow-xs">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={(e) => setSelected((s) => { const n = new Set(s); items.forEach((l) => (e.target.checked ? n.add(l.id) : n.delete(l.id))); return n; })} /></th>
                  {th(terms.Lead, 'name')}{th('Stage')}{th('Temp.')}{lf.budget ? th(lf.budget.label) : null}{th('Assigned')}{th('Score', 'score', 'text-right')}{th('Follow-up', 'nextFollowUpAt')}{th('Added', 'createdAt')}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((l) => {
                  const overdue = l.nextFollowUpAt !== null && new Date(l.nextFollowUpAt) < new Date() && l.stage.kind === 'OPEN';
                  return (
                    <tr key={l.id} className={cn('hover:bg-muted/40', selected.has(l.id) && 'bg-primary-soft/50')}>
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} /></td>
                      <td className="px-3 py-2"><Link href={`/leads/${l.id}`} className="block"><span className="font-medium hover:text-primary">{l.name}</span><span className="text-helper block">{l.phone ?? l.email}{l.location ? ` · ${l.location}` : ''}</span></Link></td>
                      <td className="px-3 py-2"><StageBadge name={l.stage.name} kind={l.stage.kind} /></td>
                      <td className="px-3 py-2"><TemperatureBadge value={l.temperature} /></td>
                      {lf.budget ? <td className="num whitespace-nowrap px-3 py-2">{formatBudget(l.budgetMin, l.budgetMax)}</td> : null}
                      <td className="px-3 py-2">{l.assignee ? <span className="flex items-center gap-2"><Avatar name={l.assignee.name} size={22} /><span className="truncate">{l.assignee.name}</span></span> : <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className="num px-3 py-2 text-right">{l.score ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className={cn('num whitespace-nowrap px-3 py-2', overdue && 'font-medium text-danger')}>{l.nextFollowUpAt ? timeAgo(l.nextFollowUpAt) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-muted-foreground">{timeAgo(l.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
        {leads.data && leads.data.total > 0 ? <Pagination page={page} pageSize={25} total={leads.data.total} onPage={setPage} /> : null}
      </Card>

      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} endpoint="/leads/import" title={`Import ${terms.leads}`} hint={lf.budget ? 'CSV with a header row. Columns: name, phone, email, budget, location, source, tags… Amounts like 85 L or 1.2 Cr work.' : 'CSV with a header row. Columns: name, phone, email, location, source, tags…'} invalidate={[['leads'], ['pipeline'], ['analytics']]} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} danger title={`Delete ${selected.size} ${selected.size === 1 ? terms.lead : terms.leads}?`} description="They disappear from lists and reports. This is recorded in the audit log." confirmLabel="Delete" onConfirm={async () => { await bulk.mutateAsync({ action: 'delete' }); }} />
    </>
  );
}
