'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useStages } from '@/lib/crm';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';
import { applyTerms } from '@/lib/terms-text';

/** Stage and lost-reason configuration (pipeline:manage). Won/Lost stages are protected and stay last. */
export function StageConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const terms = useTerms();
  const qc = useQueryClient();
  const stages = useStages();
  const [name, setName] = useState(''); const [reason, setReason] = useState('');
  const done = async () => { await qc.invalidateQueries({ queryKey: ['pipeline'] }); };
  const call = useMutation({ mutationFn: (a: { path: string; method: string; body?: unknown }) => api(a.path, { method: a.method, body: a.body }), onSuccess: done, onError: (e) => handleApiError(e) });
  const list = stages.data?.stages ?? [];
  const swap = (i: number, d: -1 | 1) => { const ids = list.map((s) => s.id); const j = i + d; const a = ids[i]; const b = ids[j]; if (a === undefined || b === undefined) return; ids[i] = b; ids[j] = a; call.mutate({ path: '/pipeline/stages/reorder', method: 'POST', body: { ids } }); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Configure pipeline" description={applyTerms("Rename, reorder and add stages. Stages with leads cannot be removed.", terms)} className="max-w-lg">
        <div className="space-y-5">
          <ul className="space-y-1.5">
            {list.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="flex flex-col"><button aria-label={`Move ${s.name} up`} disabled={i === 0 || s.kind !== 'OPEN'} className="text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => swap(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button><button aria-label={`Move ${s.name} down`} disabled={s.kind !== 'OPEN' || list[i + 1]?.kind !== 'OPEN'} className="text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => swap(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button></div>
                <Input aria-label={`Name of stage ${s.name}`} defaultValue={s.name} className="h-8" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) call.mutate({ path: `/pipeline/stages/${s.id}`, method: 'PATCH', body: { name: v } }); }} />
                {s.kind !== 'OPEN' ? <Badge tone={s.kind === 'WON' ? 'success' : 'danger'}>{s.kind === 'WON' ? 'Won' : 'Lost'}</Badge> : (
                  <>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={applyTerms("Leads at or past this stage count as qualified", terms)}><input type="checkbox" defaultChecked={s.qualifies} onChange={(e) => call.mutate({ path: `/pipeline/stages/${s.id}`, method: 'PATCH', body: { qualifies: e.target.checked } })} />Qualified</label>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={applyTerms("Leads can be marked Won from this stage", terms)}><input type="checkbox" defaultChecked={s.canCloseWon} onChange={(e) => call.mutate({ path: `/pipeline/stages/${s.id}`, method: 'PATCH', body: { canCloseWon: e.target.checked } })} />Can win</label>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${s.name}`} onClick={() => call.mutate({ path: `/pipeline/stages/${s.id}`, method: 'DELETE' })}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { call.mutate({ path: '/pipeline/stages', method: 'POST', body: { name: name.trim() } }); setName(''); } }}>
            <Input aria-label="New stage name" placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" disabled={!name.trim()}><Plus className="h-4 w-4" aria-hidden />Add stage</Button>
          </form>
          <div>
            <p className="text-label mb-2">Lost reasons</p>
            <ul className="mb-2 flex flex-wrap gap-1.5">{stages.data?.lostReasons.map((r) => <li key={r.id}><button onClick={() => call.mutate({ path: `/pipeline/lost-reasons/${r.id}`, method: 'PATCH', body: { active: !r.active } })} title={r.active ? 'Click to hide this reason' : 'Click to show this reason'} className={r.active ? '' : 'opacity-50 line-through'}><Badge>{r.name}</Badge></button></li>)}</ul>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { call.mutate({ path: '/pipeline/lost-reasons', method: 'POST', body: { name: reason.trim() } }); setReason(''); } }}>
              <Input aria-label="New lost reason" placeholder="Add a reason" value={reason} onChange={(e) => setReason(e.target.value)} /><Button type="submit" disabled={!reason.trim()}>Add</Button>
            </form>
          </div>
        </div>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => { toast.success('Pipeline saved'); onOpenChange(false); }}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}
