'use client';

import type { LeadDto } from '@leadpilot/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRightLeft, KanbanSquare, Settings2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TemperatureBadge } from '@/components/crm/lead-badges';
import { StageConfigDialog } from '@/components/crm/stage-config-dialog';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { qs, useMembers, useStages } from '@/lib/crm';
import { formatBudget } from '@/lib/format';
import { usePack, useTerms } from '@/lib/pack';

interface Column { stage: { id: string; key: string; name: string; kind: 'OPEN' | 'WON' | 'LOST'; position: number }; total: number; leads: LeadDto[] }

export default function PipelinePage() {
  const { can } = useAuth();
  const lf = usePack().leadFields;
  const terms = useTerms();
  const qc = useQueryClient();
  const stages = useStages(); const members = useMembers();
  const [filters, setFilters] = useState({ assigned: '', temperature: '' });
  const [drag, setDrag] = useState<LeadDto | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [lost, setLost] = useState<{ lead: LeadDto; stageId: string } | null>(null);
  const [reason, setReason] = useState(''); const [note, setNote] = useState('');
  const [configOpen, setConfigOpen] = useState(false);

  const board = useQuery({ queryKey: ['pipeline', 'board', filters], queryFn: () => api<{ columns: Column[] }>(`/pipeline/board${qs(filters)}`) });

  const move = useMutation({
    mutationFn: (v: { lead: LeadDto; stageId: string; lostReasonId?: string; lostNote?: string }) => api(`/leads/${v.lead.id}/stage`, { method: 'POST', body: { stageId: v.stageId, lostReasonId: v.lostReasonId, lostNote: v.lostNote } }),
    // Optimistic: move the card immediately, roll back if the server rejects the transition.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['pipeline', 'board'] });
      const key = ['pipeline', 'board', filters];
      const prev = qc.getQueryData<{ columns: Column[] }>(key);
      if (prev) qc.setQueryData(key, { columns: prev.columns.map((c) => c.stage.id === v.lead.stage.id ? { ...c, total: c.total - 1, leads: c.leads.filter((l) => l.id !== v.lead.id) } : c.stage.id === v.stageId ? { ...c, total: c.total + 1, leads: [{ ...v.lead, stage: { ...c.stage } }, ...c.leads] } : c) });
      return { prev, key };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); setNotice({ text: e instanceof ApiError ? e.message : `Could not move the ${terms.lead}`, ok: false }); },
    onSuccess: (_d, v) => { const name = stages.data?.stages.find((s) => s.id === v.stageId)?.name; setNotice({ text: `${v.lead.name} moved to ${name}`, ok: true }); setLost(null); setReason(''); setNote(''); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['pipeline'] }); void qc.invalidateQueries({ queryKey: ['leads'] }); void qc.invalidateQueries({ queryKey: ['analytics'] }); },
  });

  const request = (lead: LeadDto, stageId: string) => {
    if (lead.stage.id === stageId) return;
    const target = stages.data?.stages.find((s) => s.id === stageId);
    if (target?.kind === 'LOST') { setLost({ lead, stageId }); return; }
    move.mutate({ lead, stageId });
  };

  return (
    <>
      <PageHeader title="Sales pipeline" description="Drag a card to another stage, or use the move menu on the card." actions={<>
        {can('lead:write:all') ? <Select aria-label="Assigned to" className="w-auto" value={filters.assigned} onChange={(e) => setFilters((f) => ({ ...f, assigned: e.target.value }))}><option value="">Everyone</option><option value="me">Mine</option><option value="unassigned">Unassigned</option>{members.data?.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select> : null}
        <Select aria-label="Temperature" className="w-auto" value={filters.temperature} onChange={(e) => setFilters((f) => ({ ...f, temperature: e.target.value }))}><option value="">Any temperature</option><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option></Select>
        {can('pipeline:manage') ? <Button onClick={() => setConfigOpen(true)}><Settings2 className="h-4 w-4" aria-hidden />Configure</Button> : null}
      </>} />

      <div aria-live="polite" className="mb-3 h-8">
        <AnimatePresence mode="wait">{notice ? <motion.p key={notice.text} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium', notice.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>{notice.ok ? null : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}{notice.text}</motion.p> : null}</AnimatePresence>
      </div>

      {board.isPending ? <div className="flex gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-96 w-64" />)}</div> : board.isError ? (
        <EmptyState icon={KanbanSquare} title="Could not load the pipeline" description="Check your connection and try again." action={<Button onClick={() => void board.refetch()}>Retry</Button>} />
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
          {board.data.columns.map((col) => (
            <section key={col.stage.id} aria-label={`${col.stage.name}, ${col.total} ${terms.leads}`} onDragOver={(e) => { e.preventDefault(); setOver(col.stage.id); }} onDragLeave={() => setOver((o) => (o === col.stage.id ? null : o))} onDrop={() => { if (drag) request(drag, col.stage.id); setDrag(null); setOver(null); }}
              className={cn('flex max-h-[calc(100dvh-14rem)] w-64 shrink-0 flex-col rounded-lg border bg-muted/50 transition-colors', over === col.stage.id ? 'border-primary bg-primary-soft/40' : 'border-border')}>
              <header className="flex items-center justify-between px-3 py-2.5"><h2 className="flex items-center gap-1.5 text-label"><span className={cn('h-2 w-2 rounded-full', col.stage.kind === 'WON' ? 'bg-success' : col.stage.kind === 'LOST' ? 'bg-danger' : 'bg-primary')} aria-hidden />{col.stage.name}</h2><span className="num text-helper">{col.total}</span></header>
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {col.leads.map((l) => (
                  <motion.li layout key={l.id} transition={{ type: 'spring', stiffness: 500, damping: 40 }} draggable onDragStart={() => setDrag(l)} onDragEnd={() => { setDrag(null); setOver(null); }} className={cn('cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing', drag?.id === l.id && 'opacity-50')}>
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/leads/${l.id}`} className="text-[13px] font-medium hover:text-primary">{l.name}</Link>
                      <Dropdown trigger={<button aria-label={`Move ${l.name}`} className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-muted lg:h-6 lg:w-6"><ArrowRightLeft className="h-3.5 w-3.5" /></button>}>
                        {stages.data?.stages.filter((s) => s.id !== l.stage.id).map((s) => <DropdownItem key={s.id} onSelect={() => request(l, s.id)}>Move to {s.name}</DropdownItem>)}
                      </Dropdown>
                    </div>
                    <p className="num text-helper mt-0.5">{lf.budget ? formatBudget(l.budgetMin, l.budgetMax) : null}{lf.budget && l.location ? ' · ' : ''}{l.location ?? ''}</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      {l.assignee ? <span className="flex items-center gap-1.5"><Avatar name={l.assignee.name} size={20} /><span className="text-helper truncate">{l.assignee.name.split(' ')[0]}</span></span> : <span className="text-helper">Unassigned</span>}
                      <TemperatureBadge value={l.temperature} />
                    </div>
                  </motion.li>
                ))}
                {col.total > col.leads.length ? <li className="text-helper py-1 text-center">Showing {col.leads.length} of {col.total}. <Link className="text-primary underline underline-offset-2 hover:no-underline" href={`/leads?stageId=${col.stage.id}`}>See all</Link></li> : null}
                {col.leads.length === 0 ? <li className="rounded-lg border border-dashed border-border-strong py-6 text-center text-helper">Drop {terms.aLead} here</li> : null}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={lost !== null} onOpenChange={(o) => { if (!o) setLost(null); }}>
        <DialogContent title={`Mark ${lost?.lead.name ?? terms.lead} as lost?`} description="Choose a reason so you can see where deals fall through.">
          <div className="space-y-3">
            <Field label="Reason" htmlFor="pl-reason"><Select id="pl-reason" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose a reason…</option>{stages.data?.lostReasons.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Field label="Note (optional)" htmlFor="pl-note"><Textarea id="pl-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setLost(null)}>Cancel</Button><Button variant="danger" disabled={!reason} loading={move.isPending} onClick={() => lost && move.mutate({ lead: lost.lead, stageId: lost.stageId, lostReasonId: reason, ...(note ? { lostNote: note } : {}) })}>Mark as lost</Button></div>
        </DialogContent>
      </Dialog>
      <StageConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </>
  );
}
