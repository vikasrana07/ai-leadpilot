'use client';

import { useMutation } from '@tanstack/react-query';
import { Download, ShieldAlert, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';

/** Data-principal rights for one lead: download everything held about them, or erase it permanently. */
export function LeadPrivacyMenu({ leadId, leadName }: { leadId: string; leadName: string }) {
  const terms = useTerms();
  const { can } = useAuth();
  const router = useRouter();
  const [eraseOpen, setEraseOpen] = useState(false);
  const [confirm, setConfirm] = useState(''); const [reason, setReason] = useState('');
  const canExport = can('lead:export') && can('lead:read:all');
  const canErase = can('lead:delete') && can('lead:read:all');

  const exportData = useMutation({
    mutationFn: () => api<unknown>(`/privacy/leads/${leadId}/export`),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `lead-${leadId.slice(0, 8)}-export.json`; a.click(); URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    },
    onError: (e) => handleApiError(e),
  });
  const erase = useMutation({
    mutationFn: () => api<{ counts: Record<string, number> }>(`/privacy/leads/${leadId}/erase`, { method: 'POST', body: { reason, confirm: 'ERASE' } }),
    onSuccess: () => { toast.success('All data about this person was permanently erased'); setEraseOpen(false); router.replace('/leads'); },
    onError: (e) => handleApiError(e),
  });
  if (!canExport && !canErase) return null;
  const ready = confirm === 'ERASE' && reason.trim().length >= 5;
  return (
    <>
      <Dropdown trigger={<Button aria-label="Privacy actions"><ShieldAlert className="h-4 w-4" aria-hidden />Privacy</Button>}>
        <DropdownLabel>Data principal requests</DropdownLabel>
        {canExport ? <DropdownItem onSelect={() => exportData.mutate()}><Download className="h-4 w-4" aria-hidden />Export data (JSON)</DropdownItem> : null}
        {canErase ? <DropdownItem danger onSelect={() => { setConfirm(''); setReason(''); setEraseOpen(true); }}><Trash2 className="h-4 w-4" aria-hidden />Erase permanently…</DropdownItem> : null}
      </Dropdown>
      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent title={`Erase ${leadName} permanently?`} description="This cannot be undone.">
          <div className="space-y-3 text-[13px]">
            <p>This deletes the {terms.lead} and everything linked to them: conversations and messages, notes, activity, appointments, tasks, consent records, scores and stored provider payloads that mention their phone number. Only a record that an erasure happened (who, when, why) is kept in the audit log.</p>
            <Field label="Why are you erasing this data?" htmlFor="erase-reason" hint="e.g. the request reference from the customer"><Input id="erase-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label="Type ERASE to confirm" htmlFor="erase-confirm"><Input id="erase-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
          </div>
          <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setEraseOpen(false)}>Cancel</Button><Button variant="danger" disabled={!ready} loading={erase.isPending} onClick={() => erase.mutate()}>Erase permanently</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
