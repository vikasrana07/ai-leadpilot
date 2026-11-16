'use client';

import { useMutation } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform';

/** Platform console: open a READ-ONLY support session in a workspace (reason + password required, 30 minutes at most, visible to the customer). */
export function SupportAccessButton({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [password, setPassword] = useState(''); const [minutes, setMinutes] = useState('30');
  const start = useMutation({
    mutationFn: () => platformApi<{ openUrl: string }>(`/tenants/${tenantId}/support-session`, { method: 'POST', body: { reason, password, minutes: Number(minutes) } }),
    onSuccess: (r) => { toast.success('Support session started. Opening the workspace (read-only)…'); window.location.assign(r.openUrl); },
    onError: (e) => toast.error(e instanceof ApiError ? (e.details?.[0]?.message ?? e.message) : 'Could not start the session'),
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}><LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Support access</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPassword(''); }}>
        <DialogContent title="Start a read-only support session" description="You will see this workspace as a read-only member for a limited time. You cannot change anything, and the customer is told who looked and why. Use a separate browser profile: the session replaces any workspace login in this browser.">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
            <Field label="Reason (shown to the customer)" htmlFor="sp-reason"><Textarea id="sp-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} required placeholder="e.g. Customer reported leads missing from the list (ticket 1234)" /></Field>
            <Field label="Duration" htmlFor="sp-min"><Select id="sp-min" value={minutes} onChange={(e) => setMinutes(e.target.value)}><option value="10">10 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes (maximum)</option></Select></Field>
            <Field label="Confirm with your password" htmlFor="sp-pw"><Input id="sp-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={start.isPending || reason.trim().length < 10 || !password}>Start session</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
