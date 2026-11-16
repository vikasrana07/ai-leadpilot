'use client';

import { WEBHOOK_EVENTS } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface Endpoint { id: string; url: string; description: string | null; events: string[]; enabled: boolean; disabledReason: string | null; consecutiveFailures: number; secretPrefix: string; lastDelivery: { status: string; at: string; statusCode: number | null } | null; last7d: Record<string, number> }
interface Delivery { id: string; eventType: string; test: boolean; status: string; attempts: number; statusCode: number | null; latencyMs: number | null; error: string | null; createdAt: string; nextAttemptAt: string | null }
const tone = (s: string) => (s === 'SUCCEEDED' ? 'success' : s === 'FAILED' ? 'danger' : 'warning');

function Secret({ value, onClose }: { value: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={value !== null} onOpenChange={(o) => { if (!o) { onClose(); setCopied(false); } }}>
      <DialogContent title="Copy your signing secret" description="Use it to verify that webhook requests really come from LeadPilot. This is the only time it is shown.">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5"><code className="min-w-0 flex-1 break-all font-mono text-[12px]">{value}</code><Button size="sm" aria-label="Copy secret" onClick={() => { if (value) void navigator.clipboard.writeText(value).then(() => setCopied(true)); }}>{copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}</Button></div>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => { onClose(); setCopied(false); }}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function Deliveries({ endpoint, onClose }: { endpoint: Endpoint | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhook-deliveries', endpoint?.id], queryFn: () => api<Delivery[]>(`/webhooks/endpoints/${endpoint?.id}/deliveries?limit=50`), enabled: endpoint !== null, refetchInterval: 5000 });
  const redo = useMutation({ mutationFn: (id: string) => api(`/webhooks/deliveries/${id}/redeliver`, { method: 'POST' }), onSuccess: async () => { toast.success('Queued for redelivery'); await qc.invalidateQueries({ queryKey: ['webhook-deliveries', endpoint?.id] }); }, onError: (e) => handleApiError(e) });
  return (
    <Dialog open={endpoint !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Delivery log" description={endpoint?.url} className="max-w-3xl">
        {q.isPending ? <Skeleton className="h-32" /> : q.data && q.data.length > 0 ? (
          <div className="max-h-96 overflow-auto"><table className="w-full text-[12px]"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1.5 pr-2 font-medium">Event</th><th className="pr-2 font-medium">Status</th><th className="pr-2 font-medium">Tries</th><th className="pr-2 font-medium">HTTP</th><th className="pr-2 font-medium">Time</th><th className="pr-2 font-medium">When</th><th /></tr></thead>
            <tbody>{q.data.map((d) => <tr key={d.id} className="border-b border-border align-top last:border-0"><td className="py-1.5 pr-2"><code className="font-mono">{d.eventType}</code>{d.test ? <Badge className="ml-1">test</Badge> : null}{d.error ? <p className="text-danger">{d.error}</p> : null}</td><td className="pr-2"><Badge tone={tone(d.status)}>{d.status.toLowerCase()}</Badge>{d.nextAttemptAt ? <p className="text-muted-foreground">retry {timeAgo(d.nextAttemptAt)}</p> : null}</td><td className="num pr-2">{d.attempts}</td><td className="num pr-2">{d.statusCode ?? '-'}</td><td className="num pr-2">{d.latencyMs !== null ? `${d.latencyMs} ms` : '-'}</td><td className="pr-2">{timeAgo(d.createdAt)}</td><td>{d.status !== 'PENDING' && d.status !== 'SENDING' && !d.test ? <Button size="sm" onClick={() => redo.mutate(d.id)} disabled={redo.isPending}>Redeliver</Button> : null}</td></tr>)}</tbody></table></div>
        ) : <p className="text-helper py-6 text-center">No deliveries yet.</p>}
      </DialogContent>
    </Dialog>
  );
}

export default function WebhooksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['webhook-endpoints'], queryFn: () => api<Endpoint[]>('/webhooks/endpoints'), enabled: can('integration:manage'), retry: false });
  const [open, setOpen] = useState(false); const [url, setUrl] = useState('https://'); const [desc, setDesc] = useState(''); const [events, setEvents] = useState<string[]>(['lead.created']);
  const [secret, setSecret] = useState<string | null>(null); const [viewing, setViewing] = useState<Endpoint | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });
  const create = useMutation({ mutationFn: () => api<{ secret: string }>('/webhooks/endpoints', { method: 'POST', body: { url: url.trim(), events, ...(desc.trim() ? { description: desc.trim() } : {}) } }), onSuccess: async (r) => { setSecret(r.secret); setOpen(false); setUrl('https://'); setDesc(''); setEvents(['lead.created']); await refresh(); }, onError: (e) => handleApiError(e) });
  const patch = useMutation({ mutationFn: (a: { id: string; enabled: boolean }) => api(`/webhooks/endpoints/${a.id}`, { method: 'PATCH', body: { enabled: a.enabled } }), onSuccess: refresh, onError: (e) => handleApiError(e) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/webhooks/endpoints/${id}`, { method: 'DELETE' }), onSuccess: async () => { toast.success('Endpoint removed'); await refresh(); }, onError: (e) => handleApiError(e) });
  const rotate = useMutation({ mutationFn: (id: string) => api<{ secret: string }>(`/webhooks/endpoints/${id}/rotate-secret`, { method: 'POST' }), onSuccess: async (r) => { setSecret(r.secret); await refresh(); }, onError: (e) => handleApiError(e) });
  const test = useMutation({ mutationFn: (id: string) => api<{ status: string; statusCode: number | null; error: string | null }>(`/webhooks/endpoints/${id}/test`, { method: 'POST' }), onSuccess: async (r) => { if (r.status === 'SUCCEEDED') toast.success(`Test delivered (HTTP ${r.statusCode})`); else toast.error(r.error ?? 'Test failed'); await refresh(); }, onError: (e) => handleApiError(e) });
  const toggle = (ev: string) => setEvents((c) => (c.includes(ev) ? c.filter((x) => x !== ev) : [...c, ev]));

  if (!can('integration:manage')) return <><PageHeader title="Webhooks" /><Card><EmptyState icon={Webhook} title="Only workspace owners can manage webhooks" description="Ask an owner to set one up." /></Card></>;
  const gated = list.error instanceof ApiError && list.error.status === 402;

  return (
    <>
      <PageHeader title="Webhooks" description="Get a signed HTTPS request the moment something happens in your workspace." actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={gated}>Add endpoint</Button>} />
      {gated ? <Card><EmptyState icon={Webhook} title="Webhooks are not included in your plan" description="Upgrade to Growth or Premium to use webhooks and the public API." action={<Button asChild variant="primary"><Link href="/billing">See plans</Link></Button>} /></Card>
        : list.isPending ? <Skeleton className="h-40" />
        : list.data && list.data.length > 0 ? (
          <div className="space-y-3">{list.data.map((e) => (
            <Card key={e.id}><CardBody className="space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1"><p className="break-all text-[13px] font-medium">{e.url}</p>{e.description ? <p className="text-helper">{e.description}</p> : null}</div>
                <Badge tone={e.enabled ? 'success' : 'danger'}>{e.enabled ? 'On' : 'Off'}</Badge>
              </div>
              {!e.enabled && e.disabledReason ? <p className="rounded-lg border border-danger/30 bg-danger-soft p-2 text-[12px] text-danger">{e.disabledReason}</p> : null}
              <div className="flex flex-wrap gap-1">{e.events.map((ev) => <Badge key={ev} tone="primary">{ev}</Badge>)}</div>
              <p className="text-helper">Secret <code className="font-mono">{e.secretPrefix}…</code> · {e.lastDelivery ? `last delivery ${e.lastDelivery.status.toLowerCase()} ${timeAgo(e.lastDelivery.at)}${e.lastDelivery.statusCode ? ` (HTTP ${e.lastDelivery.statusCode})` : ''}` : 'no deliveries yet'} · last 7 days: {Object.entries(e.last7d).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ') || 'none'}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => test.mutate(e.id)} disabled={test.isPending || !e.enabled}>Send test event</Button>
                <Button size="sm" onClick={() => setViewing(e)}>Delivery log</Button>
                <Button size="sm" onClick={() => patch.mutate({ id: e.id, enabled: !e.enabled })}>{e.enabled ? 'Switch off' : 'Switch on'}</Button>
                <Button size="sm" onClick={() => { if (window.confirm('Generate a new secret? The old one stops working immediately.')) rotate.mutate(e.id); }}>Rotate secret</Button>
                <Button size="sm" variant="danger" onClick={() => { if (window.confirm('Remove this endpoint and its delivery log?')) remove.mutate(e.id); }}>Remove</Button>
              </div>
            </CardBody></Card>))}</div>
        ) : <Card><EmptyState icon={Webhook} title="No endpoints yet" description="Add an HTTPS URL and choose the events you want." action={<Button variant="primary" onClick={() => setOpen(true)}>Add endpoint</Button>} /></Card>}

      <Card className="mt-6"><CardBody className="space-y-2"><p className="text-[13px] font-medium">Verifying a request</p>
        <p className="text-helper">Each request carries <code className="font-mono">X-LeadPilot-Timestamp</code> and <code className="font-mono">X-LeadPilot-Signature: v1=&lt;hex&gt;</code>, the HMAC-SHA256 of <code className="font-mono">timestamp + &quot;.&quot; + raw body</code> with your secret. Reject requests whose timestamp is more than 5 minutes old. Bodies carry ids only; fetch details with the public API. Redirects are not followed, and private network addresses are refused.</p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12px] leading-5">{`const expected = 'v1=' + crypto.createHmac('sha256', SECRET)\n  .update(ts + '.' + rawBody).digest('hex');\nconst ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));`}</pre></CardBody></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add webhook endpoint" description="LeadPilot will POST a signed JSON body to this HTTPS URL." className="max-w-lg">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (events.length) create.mutate(); }}>
            <Field label="Endpoint URL" htmlFor="w-url"><Input id="w-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://example.com/leadpilot-webhook" /></Field>
            <Field label="Description (optional)" htmlFor="w-desc"><Input id="w-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} /></Field>
            <fieldset><legend className="text-label mb-1.5">Events</legend><div className="grid max-h-44 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">{WEBHOOK_EVENTS.map((ev) => <label key={ev} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={events.includes(ev)} onChange={() => toggle(ev)} /><code className="font-mono text-[12px]">{ev}</code></label>)}</div></fieldset>
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={create.isPending || events.length === 0}>Add endpoint</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Secret value={secret} onClose={() => setSecret(null)} />
      <Deliveries endpoint={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
