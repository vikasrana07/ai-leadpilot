'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ScoreRing } from '@/components/crm/score-ring';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import type { ScoreView } from '@/lib/ai';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';

/** Lead score: ring with explanation, manager override (reason required, audited), and score history. */
export function ScoreCard({ leadId }: { leadId: string }) {
  const terms = useTerms();
  const { can } = useAuth();
  const qc = useQueryClient();
  const score = useQuery({ queryKey: ['leads', 'score', leadId], queryFn: () => api<ScoreView>(`/leads/${leadId}/score`) });
  const [open, setOpen] = useState(false); const [value, setValue] = useState('50'); const [reason, setReason] = useState('');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['leads'] }), qc.invalidateQueries({ queryKey: ['analytics'] })]);
  const override = useMutation({ mutationFn: () => api(`/leads/${leadId}/score/override`, { method: 'POST', body: { score: Number(value), reason } }), onSuccess: async () => { toast.success('Score overridden'); setOpen(false); setReason(''); await refresh(); }, onError: (e) => handleApiError(e) });
  const clear = useMutation({ mutationFn: () => api(`/leads/${leadId}/score/override`, { method: 'DELETE' }), onSuccess: async () => { toast.success('Back to automatic scoring'); await refresh(); }, onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not clear') });
  const v = score.data;
  const canOverride = can('lead:score:override');

  return (
    <Card>
      <CardHeader><CardTitle>{terms.Lead} score</CardTitle>{v?.overridden ? <Badge tone="warning"><ShieldCheck className="h-3 w-3" aria-hidden />Set by a manager</Badge> : <Badge>Automatic</Badge>}</CardHeader>
      <CardBody className="space-y-4">
        {score.isPending ? <Skeleton className="h-20" /> : !v ? <p className="text-helper">Score unavailable.</p> : (
          <>
            <div className="flex items-center gap-4">
              <ScoreRing score={v.score} temperature={v.temperature} factors={v.breakdown} />
              <div className="min-w-0 flex-1 text-[13px]">
                {v.overridden ? <p className="text-muted-foreground">Automatic score would be <span className="num font-medium text-foreground">{v.automaticScore}</span>. It stays as set until cleared.</p> : <p className="text-muted-foreground">Updates automatically as the customer shares details. Click the ring to see why.</p>}
                <p className="text-helper mt-1">Rules version {v.ruleVersion || 'default'}{v.scoredAt ? ` · scored ${timeAgo(v.scoredAt)}` : ''}</p>
              </div>
            </div>
            {canOverride ? <div className="flex gap-2"><Button size="sm" onClick={() => { setValue(String(v.score ?? 50)); setOpen(true); }}>Override score</Button>{v.overridden ? <Button size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>Return to automatic</Button> : null}</div> : null}
            {v.history.length ? (
              <div>
                <p className="text-label mb-1.5 flex items-center gap-1.5 text-muted-foreground"><History className="h-3.5 w-3.5" aria-hidden />History</p>
                <ul className="space-y-1.5">{v.history.slice(0, 6).map((h) => <li key={h.id} className="flex items-start justify-between gap-2 text-[12px]"><span>{h.source === 'MANUAL' ? <><strong>{h.actor ?? 'A manager'}</strong> set {h.score}{h.reason ? ` · “${h.reason}”` : ''}</> : <>Calculated <strong className="num">{h.score}</strong></>}</span><time className="text-helper whitespace-nowrap">{timeAgo(h.createdAt)}</time></li>)}</ul>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Override the ${terms.lead} score`} description="Use this when you know something the data does not show. The reason is saved with your name.">
          <div className="space-y-3">
            <Field label="New score (0 to 100)" htmlFor="ov-score"><Input id="ov-score" type="number" min={0} max={100} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field label="Reason" htmlFor="ov-reason" hint="For example: customer phoned the office and is ready to pay the token amount."><Textarea id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={override.isPending} disabled={reason.trim().length < 3 || Number(value) < 0 || Number(value) > 100} onClick={() => override.mutate()}>Save override</Button></div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
