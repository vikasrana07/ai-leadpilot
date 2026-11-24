'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { OPT_IN_BASES } from '@/lib/campaigns';

interface Result { recorded: number; alreadyOptedIn: number; skippedOptedOut: number; notFound: number }

/**
 * A manager attests that the selected leads agreed to receive WhatsApp marketing. Broadcast campaigns only message leads with an explicit
 * opt-in; leads who sent STOP are never re-opted-in here. The server records who attested and on what basis.
 */
export function WhatsappOptInDialog({ open, onOpenChange, leadIds, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; leadIds: string[]; onDone: () => void }) {
  const [basis, setBasis] = useState<(typeof OPT_IN_BASES)[number]['value']>('existing_customer');
  const [attested, setAttested] = useState(false);

  const save = useMutation({
    mutationFn: () => api<Result>('/campaigns/consent/opt-in', { method: 'POST', body: { leadIds, basis, attestation: true } }),
    onSuccess: (r) => {
      const parts = [`${r.recorded} recorded`];
      if (r.alreadyOptedIn) parts.push(`${r.alreadyOptedIn} already opted in`);
      if (r.skippedOptedOut) parts.push(`${r.skippedOptedOut} skipped (they sent STOP)`);
      toast.success(`WhatsApp opt-in: ${parts.join(', ')}`);
      setAttested(false);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not record opt-in'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record WhatsApp opt-in" description={`For ${leadIds.length} selected ${leadIds.length === 1 ? 'lead' : 'leads'}. Only leads with an opt-in receive broadcast campaigns.`} variant="modal" size="md">
        <div className="space-y-4">
          <Field label="How did they agree?" htmlFor="optin-basis">
            <Select id="optin-basis" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
              {OPT_IN_BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>I confirm these people agreed to receive WhatsApp marketing messages from this business, and I can show how if asked. This is recorded with my name in the audit log.</span>
          </label>
          <p className="text-xs text-muted-foreground">Leads who already sent STOP are skipped: only they can opt back in, by messaging you.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!attested} onClick={() => save.mutate()}>Record opt-in</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
