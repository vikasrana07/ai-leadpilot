'use client';

import type { AutomationGraph } from '@leadpilot/validation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, MinusCircle, Play, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { qs } from '@/lib/crm';
import { handleApiError } from '@/lib/forms';
import { nodeTitle } from '@/lib/automation-graph-state';
import type { DryRunPathItem, DryRunResult } from '@/lib/ops';
import { describeMinutes } from './outline';

const ICON = { yes: CheckCircle2, no: XCircle, would_run: Play, would_wait: Clock, skipped: MinusCircle } as const;
const WORDS: Record<DryRunPathItem['outcome'], string> = { yes: 'Condition met: takes the If path', no: 'Condition not met: takes Otherwise', would_run: 'Would run', would_wait: 'Would wait', skipped: 'Would be skipped' };

/** Runs the DRAFT (even unsaved) graph against a real lead. Nothing is sent, assigned or created. */
export function DryRunDialog({ automationId, name, graph, onClose, onResult }: { automationId: string; name: string; graph: AutomationGraph; onClose: () => void; onResult: (r: DryRunResult | null) => void }) {
  const [search, setSearch] = useState(''); const q = useDebounce(search, 250);
  const leads = useQuery({ queryKey: ['leads', 'picker', q], queryFn: () => api<{ items: { id: string; name: string; phone: string | null }[] }>(`/leads${qs({ q, pageSize: 6 })}`) });
  const [result, setResult] = useState<DryRunResult | null>(null);
  const run = useMutation({ mutationFn: (leadId: string) => api<DryRunResult>(`/automations/${automationId}/dry-run`, { method: 'POST', body: { leadId, graph } }), onSuccess: (r) => { setResult(r); onResult(r); }, onError: (e) => handleApiError(e) });
  const title = (id: string) => { const n = graph.nodes.find((x) => x.id === id); return n ? nodeTitle(n) : id; };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Test “${name || 'this automation'}”`} description="Pick a real lead to see which path it would take. This tests your current edits, saved or not. Nothing is sent, assigned or created." className="max-w-xl">
        <Field label="Lead" htmlFor="dr-lead"><Input id="dr-lead" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" /></Field>
        {(leads.data?.items.length ?? 0) > 0 ? <ul className="mt-1 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Leads">{leads.data?.items.map((l) => <li key={l.id}><button type="button" className="flex min-h-11 w-full justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted" onClick={() => run.mutate(l.id)}><span>{l.name}</span><span className="text-helper">{l.phone}</span></button></li>)}</ul> : leads.isSuccess ? <p className="text-helper mt-1">No leads match. Add a lead first, or try another search.</p> : null}
        {run.isPending ? <Skeleton className="mt-3 h-20" /> : null}
        {result ? (
          <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-[13px]" aria-live="polite" data-testid="dry-run-result">
            <p className="font-medium">{result.context.lead} · {result.context.stage} · {result.context.temperature.toLowerCase()}</p>
            <ol className="space-y-2">
              {result.path.map((p, i) => { const I = ICON[p.outcome]; return (
                <li key={i} className="flex items-start gap-2"><I className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div className="min-w-0"><p className="break-words"><span className="font-medium">{WORDS[p.outcome]}</span>{p.type === 'wait' && p.wouldWaitMinutes ? `: ${describeMinutes(p.wouldWaitMinutes)}` : ''}</p>
                    <p className="text-helper break-words">{title(p.nodeId)}</p>
                    {p.conditions?.length ? <ul className="mt-0.5">{p.conditions.map((c, j) => <li key={j} className="flex items-center gap-1.5 text-[12px]">{c.pass ? <CheckCircle2 className="h-3 w-3" aria-label="met" /> : <XCircle className="h-3 w-3" aria-label="not met" />}{c.text}</li>)}</ul> : null}
                    {p.detail && p.type !== 'wait' && p.type !== 'branch' ? <p className="text-[12px] text-muted-foreground">{p.detail}</p> : null}</div></li>); })}
            </ol>
            {result.path.length === 0 ? <p>Nothing would run for this lead.</p> : null}
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">{result ? <Button onClick={() => { onResult(null); setResult(null); }}>Clear result</Button> : null}<Button onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}
