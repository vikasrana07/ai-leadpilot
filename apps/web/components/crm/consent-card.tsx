'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { OPT_IN_BASES } from '@/lib/campaigns';
import { timeAgo } from '@/lib/format';

type Disposition = 'ELIGIBLE' | 'OPTED_OUT' | 'NO_CONSENT';

export interface ConsentHistoryItem {
  id: string;
  status: 'OPTED_IN' | 'OPTED_OUT';
  purpose: 'TRANSACTIONAL' | 'SERVICE' | 'MARKETING';
  method: string | null;
  source: string;
  actorType: 'CUSTOMER' | 'MEMBER' | 'SYSTEM' | 'IMPORT' | null;
  actor: string | null;
  textVersion: string | null;
  evidence: Record<string, unknown> | null;
  createdAt: string;
}
interface ConsentView { whatsapp: { service: Disposition; marketing: Disposition }; history: ConsentHistoryItem[] }

const METHOD_LABELS: Record<string, string> = {
  INBOUND_MESSAGE: 'Wrote to us on WhatsApp', STOP_KEYWORD: 'Sent STOP', START_KEYWORD: 'Sent START', FORM_CHECKBOX: 'Ticked a form checkbox',
  META_LEAD_AD: 'Meta lead ad form', MANAGER_ATTESTED: 'Recorded by a team member', CSV_IMPORT: 'CSV import (importer attested)', API: 'API (caller supplied)',
  PORTAL: 'Customer portal', WIDGET: 'Website chat widget', UNSUBSCRIBE_LINK: 'Unsubscribe link',
};
const PURPOSE_LABELS = { TRANSACTIONAL: 'Transactional', SERVICE: 'Replies', MARKETING: 'Marketing' } as const;

function StateBadge({ label, state }: { label: string; state: Disposition }) {
  const tone = state === 'ELIGIBLE' ? 'success' : state === 'OPTED_OUT' ? 'danger' : 'neutral';
  const text = state === 'ELIGIBLE' ? 'Allowed' : state === 'OPTED_OUT' ? 'Opted out' : 'Not recorded';
  return <div className="flex items-center justify-between gap-3 text-[13px]"><span className="text-muted-foreground">{label}</span><Badge tone={tone}>{text}</Badge></div>;
}

/**
 * WhatsApp consent for one lead: the current state for replies and for marketing, and the append-only history showing who agreed (or
 * opted out), how, when and under which wording. Managers can record an attested marketing opt-in; anyone who can edit the lead can record
 * an opt-out. An opt-out can only be lifted by the customer (START on WhatsApp), never from here.
 */
export function ConsentCard({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [mode, setMode] = useState<'in' | 'out' | null>(null);
  const [basis, setBasis] = useState<(typeof OPT_IN_BASES)[number]['value']>('existing_customer');
  const [attested, setAttested] = useState(false);
  const [reason, setReason] = useState('');

  const q = useQuery({ queryKey: ['leads', 'consents', leadId], queryFn: () => api<ConsentView>(`/leads/${leadId}/consents`) });
  const close = () => { setMode(null); setAttested(false); setReason(''); };
  const save = useMutation({
    mutationFn: () => api<ConsentView>(`/leads/${leadId}/consents`, { method: 'POST', body: mode === 'out' ? { status: 'OPTED_OUT', reason } : { status: 'OPTED_IN', basis, attestation: true, ...(reason.trim() ? { reason } : {}) } }),
    onSuccess: async () => {
      toast.success(mode === 'out' ? 'Opt-out recorded' : 'Opt-in recorded');
      close();
      await Promise.all([qc.invalidateQueries({ queryKey: ['leads', 'consents', leadId] }), qc.invalidateQueries({ queryKey: ['leads', 'activity', leadId] })]);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not record consent'),
  });

  const d = q.data;
  const canOptIn = can('lead:write:all') && d?.whatsapp.marketing === 'NO_CONSENT';
  const canOptOut = canWrite && d?.whatsapp.service !== 'OPTED_OUT';

  return (
    <Card data-tour="lead-detail-consent">
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden />WhatsApp consent</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        {q.isLoading ? <Skeleton className="h-16 w-full" /> : q.isError || !d ? <p className="text-helper">Could not load consent.</p> : (
          <>
            <div className="space-y-2">
              <StateBadge label="Replies and service messages" state={d.whatsapp.service} />
              <StateBadge label="Marketing broadcasts" state={d.whatsapp.marketing} />
            </div>
            {d.whatsapp.marketing === 'OPTED_OUT' ? <p className="text-helper">This person opted out. Only they can opt back in, by sending START on WhatsApp.</p> : null}
            {d.history.length ? (
              <ol className="space-y-2 border-t border-border pt-3" aria-label="Consent history">
                {d.history.map((h) => (
                  <li key={h.id} className="text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{h.status === 'OPTED_IN' ? 'Opted in' : 'Opted out'} · {PURPOSE_LABELS[h.purpose]}</span>
                      <time className="text-muted-foreground" dateTime={h.createdAt} title={new Date(h.createdAt).toLocaleString()}>{timeAgo(h.createdAt)}</time>
                    </div>
                    <p className="text-muted-foreground">
                      {(h.method && METHOD_LABELS[h.method]) ?? h.source}{h.actor ? ` · ${h.actor}` : ''}{h.textVersion ? ` · wording ${h.textVersion}` : ''}
                      {typeof h.evidence?.reason === 'string' ? ` · “${h.evidence.reason}”` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            ) : <p className="text-helper border-t border-border pt-3">No consent has been recorded for this person yet.</p>}
            {canOptIn || canOptOut ? (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {canOptIn ? <Button size="sm" onClick={() => setMode('in')}>Record opt-in</Button> : null}
                {canOptOut ? <Button size="sm" variant="ghost" onClick={() => setMode('out')}>Record opt-out</Button> : null}
              </div>
            ) : null}
          </>
        )}
      </CardBody>

      <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent title={mode === 'out' ? 'Record an opt-out' : 'Record a marketing opt-in'} description={mode === 'out' ? 'Use this when the person told you they do not want WhatsApp messages. It blocks all business-initiated messages.' : 'Only record this if the person agreed to receive WhatsApp marketing and you can show how if asked.'} variant="modal" size="md">
          <div className="space-y-4">
            {mode === 'in' ? (
              <>
                <Field label="How did they agree?" htmlFor="consent-basis">
                  <Select id="consent-basis" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>{OPT_IN_BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</Select>
                </Field>
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" className="mt-0.5" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                  <span>I confirm this person agreed to receive WhatsApp marketing messages. This is recorded with my name.</span>
                </label>
              </>
            ) : null}
            <Field label={mode === 'out' ? 'Why? (required)' : 'Note (optional)'} htmlFor="consent-reason">
              <Textarea id="consent-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={mode === 'out' ? reason.trim().length < 3 : !attested} onClick={() => save.mutate()}>{mode === 'out' ? 'Record opt-out' : 'Record opt-in'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
