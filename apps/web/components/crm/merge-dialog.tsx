'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useTerms } from '@/lib/pack';
import { api, ApiError } from '@/lib/api';
import type { DuplicateInfo } from '@/lib/crm';

/** Finds leads sharing this lead's phone/email and merges the chosen ones into it. The target wins; blanks are filled. */
export function MergeDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: { id: string; name: string; phone: string | null; email: string | null } }) {
  const qc = useQueryClient();
  const terms = useTerms();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const dupes = useQuery({ queryKey: ['leads', 'dupes', lead.id], enabled: open, queryFn: () => api<DuplicateInfo[]>('/leads/check-duplicates', { method: 'POST', body: { phone: lead.phone, email: lead.email, excludeId: lead.id } }) });

  async function merge() {
    setBusy(true);
    try {
      await api(`/leads/${lead.id}/merge`, { method: 'POST', body: { sourceIds: [...picked] } });
      toast.success(`${terms.Leads} merged`);
      await qc.invalidateQueries({ queryKey: ['leads'] }); await qc.invalidateQueries({ queryKey: ['pipeline'] });
      setPicked(new Set()); onOpenChange(false);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not merge'); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Merge duplicates" description={`Keep ${lead.name} and fold the selected ${terms.leads} into it. Their notes, history and tags are kept.`}>
        {dupes.isPending ? <p className="text-helper">Looking for duplicates…</p> : dupes.data && dupes.data.length > 0 ? (
          <ul className="space-y-2">
            {dupes.data.map((d) => (
              <li key={d.id}><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-[13px] hover:bg-muted/50"><input type="checkbox" checked={picked.has(d.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} /><span className="flex-1"><span className="font-medium">{d.name}</span><span className="text-helper block">{d.phone ?? d.email} · {d.stage}</span></span></label></li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted-foreground">No other {terms.leads} share this phone number or email.</p>}
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={picked.size === 0} loading={busy} onClick={() => void merge()}>Merge {picked.size || ''}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
