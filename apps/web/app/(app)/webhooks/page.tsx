'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { WEBHOOK_EVENTS } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  secretPrefix: string;
  lastDelivery: { status: string; at: string; statusCode: number | null } | null;
  last7d: Record<string, number>;
}

interface Delivery {
  id: string;
  eventType: string;
  test: boolean;
  status: string;
  attempts: number;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
  nextAttemptAt: string | null;
}

const tone = (s: string) => (s === 'SUCCEEDED' ? 'success' : s === 'FAILED' ? 'danger' : 'warning');

const webhookEndpointFormSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Endpoint URL is required')
    .url('Please enter a valid URL, e.g. https://example.com/webhook')
    .refine((val) => val.startsWith('https://'), 'Webhook URL must start with https://')
    .max(500, 'URL cannot exceed 500 characters'),
  description: z.string().trim().max(200, 'Description cannot exceed 200 characters').optional(),
  events: z.array(z.string()).min(1, 'Please select at least one event'),
});

type WebhookEndpointFormValues = z.infer<typeof webhookEndpointFormSchema>;

function Secret({ value, onClose }: { value: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={value !== null} onOpenChange={(o) => { if (!o) { onClose(); setCopied(false); } }}>
      <DialogContent
        title="Copy your signing secret"
        description="Use it to verify that webhook requests really come from LeadPilot. This is the only time it is shown."
        size="md"
      >
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{value}</code>
          <Button
            size="sm"
            aria-label="Copy secret"
            onClick={() => {
              if (value) void navigator.clipboard.writeText(value).then(() => setCopied(true));
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </Button>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => { onClose(); setCopied(false); }}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Deliveries({ endpoint, onClose }: { endpoint: Endpoint | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['webhook-deliveries', endpoint?.id],
    queryFn: () => api<Delivery[]>(`/webhooks/endpoints/${endpoint?.id}/deliveries?limit=50`),
    enabled: endpoint !== null,
    refetchInterval: 5000,
  });
  const redo = useMutation({
    mutationFn: (id: string) => api(`/webhooks/deliveries/${id}/redeliver`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Queued for redelivery');
      await qc.invalidateQueries({ queryKey: ['webhook-deliveries', endpoint?.id] });
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <Dialog open={endpoint !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Delivery log" description={endpoint?.url} className="max-w-3xl">
        {q.isPending ? (
          <Skeleton className="h-32" />
        ) : q.data && q.data.length > 0 ? (
          <div className="overflow-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Event</th>
                  <th className="pr-2 font-medium">Status</th>
                  <th className="pr-2 font-medium">Tries</th>
                  <th className="pr-2 font-medium">HTTP</th>
                  <th className="pr-2 font-medium">Time</th>
                  <th className="pr-2 font-medium">When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.map((d) => (
                  <tr key={d.id} className="border-b border-border align-top last:border-0">
                    <td className="py-1.5 pr-2">
                      <code className="font-mono">{d.eventType}</code>
                      {d.test ? <Badge className="ml-1">test</Badge> : null}
                      {d.error ? <p className="text-danger">{d.error}</p> : null}
                    </td>
                    <td className="pr-2">
                      <Badge tone={tone(d.status)}>{d.status.toLowerCase()}</Badge>
                      {d.nextAttemptAt ? <p className="text-muted-foreground">retry {timeAgo(d.nextAttemptAt)}</p> : null}
                    </td>
                    <td className="num pr-2">{d.attempts}</td>
                    <td className="num pr-2">{d.statusCode ?? '-'}</td>
                    <td className="num pr-2">{d.latencyMs !== null ? `${d.latencyMs} ms` : '-'}</td>
                    <td className="pr-2">{timeAgo(d.createdAt)}</td>
                    <td>
                      {d.status !== 'PENDING' && d.status !== 'SENDING' && !d.test ? (
                        <Button size="sm" onClick={() => redo.mutate(d.id)} disabled={redo.isPending}>
                          Redeliver
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-helper py-6 text-center">No deliveries yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddEndpointDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (secret: string) => void;
}) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<WebhookEndpointFormValues>({
    resolver: zodResolver(webhookEndpointFormSchema),
    defaultValues: {
      url: 'https://',
      description: '',
      events: ['lead.created'],
    },
  });

  const selectedEvents = watch('events') ?? [];

  const toggleEvent = (ev: string) => {
    const next = selectedEvents.includes(ev)
      ? selectedEvents.filter((x) => x !== ev)
      : [...selectedEvents, ev];
    setValue('events', next, { shouldValidate: true, shouldDirty: true });
  };

  const onSubmit = async (values: WebhookEndpointFormValues) => {
    try {
      const res = await api<{ secret: string }>('/webhooks/endpoints', {
        method: 'POST',
        body: {
          url: values.url.trim(),
          events: values.events,
          ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      reset();
      onOpenChange(false);
      onCreated(res.secret);
    } catch (e) {
      handleApiError(e, setError);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent
        title="Add webhook endpoint"
        description="LeadPilot will POST a signed JSON body to this HTTPS URL."
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormErrorAlert errors={errors} />
          <Field label="Endpoint URL *" htmlFor="w-url" error={errors.url?.message}>
            <Input
              id="w-url"
              placeholder="https://example.com/leadpilot-webhook"
              autoFocus
              {...register('url')}
            />
          </Field>

          <Field label="Description (optional)" htmlFor="w-desc" error={errors.description?.message}>
            <Input
              id="w-desc"
              placeholder="e.g. Lead sync to internal CRM"
              maxLength={200}
              {...register('description')}
            />
          </Field>

          <fieldset className="space-y-1.5">
            <legend className="text-label mb-1.5">Events *</legend>
            {errors.events?.message ? (
              <p role="alert" className="text-helper !text-danger mb-1.5">
                {errors.events.message}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((ev) => {
                const checked = selectedEvents.includes(ev);
                return (
                  <label
                    key={ev}
                    className="flex cursor-pointer items-center gap-2 rounded p-1 text-[13px] hover:bg-muted/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEvent(ev)}
                    />
                    <code className="font-mono text-[12px]">{ev}</code>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Add endpoint
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WebhooksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: () => api<Endpoint[]>('/webhooks/endpoints'),
    enabled: can('integration:manage'),
    retry: false,
  });

  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Endpoint | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });

  const patch = useMutation({
    mutationFn: (a: { id: string; enabled: boolean }) =>
      api(`/webhooks/endpoints/${a.id}`, { method: 'PATCH', body: { enabled: a.enabled } }),
    onSuccess: refresh,
    onError: (e) => handleApiError(e),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/webhooks/endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Endpoint removed');
      await refresh();
    },
    onError: (e) => handleApiError(e),
  });

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api<{ secret: string }>(`/webhooks/endpoints/${id}/rotate-secret`, { method: 'POST' }),
    onSuccess: async (r) => {
      setSecret(r.secret);
      await refresh();
    },
    onError: (e) => handleApiError(e),
  });

  const test = useMutation({
    mutationFn: (id: string) =>
      api<{ status: string; statusCode: number | null; error: string | null }>(
        `/webhooks/endpoints/${id}/test`,
        { method: 'POST' },
      ),
    onSuccess: async (r) => {
      if (r.status === 'SUCCEEDED') toast.success(`Test delivered (HTTP ${r.statusCode})`);
      else toast.error(r.error ?? 'Test failed');
      await refresh();
    },
    onError: (e) => handleApiError(e),
  });

  if (!can('integration:manage')) {
    return (
      <>
        <PageHeader title="Webhooks" />
        <Card>
          <EmptyState
            icon={Webhook}
            title="Only workspace owners can manage webhooks"
            description="Ask an owner to set one up."
          />
        </Card>
      </>
    );
  }

  const gated = list.error instanceof ApiError && list.error.status === 402;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Get a signed HTTPS request the moment something happens in your workspace."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)} disabled={gated}>
            Add endpoint
          </Button>
        }
      />

      {gated ? (
        <Card>
          <EmptyState
            icon={Webhook}
            title="Webhooks are not included in your plan"
            description="Upgrade to Growth or Premium to use webhooks and the public API."
            action={
              <Button asChild variant="primary">
                <Link href="/billing">See plans</Link>
              </Button>
            }
          />
        </Card>
      ) : list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.data && list.data.length > 0 ? (
        <div className="space-y-3">
          {list.data.map((e) => (
            <Card key={e.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-[13px] font-medium">{e.url}</p>
                    {e.description ? <p className="text-helper">{e.description}</p> : null}
                  </div>
                  <Badge tone={e.enabled ? 'success' : 'danger'}>{e.enabled ? 'On' : 'Off'}</Badge>
                </div>
                {!e.enabled && e.disabledReason ? (
                  <p className="rounded-lg border border-danger/30 bg-danger-soft p-2 text-[12px] text-danger">
                    {e.disabledReason}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {e.events.map((ev) => (
                    <Badge key={ev} tone="primary">
                      {ev}
                    </Badge>
                  ))}
                </div>
                <p className="text-helper">
                  Secret <code className="font-mono">{e.secretPrefix}…</code> ·{' '}
                  {e.lastDelivery
                    ? `last delivery ${e.lastDelivery.status.toLowerCase()} ${timeAgo(e.lastDelivery.at)}${e.lastDelivery.statusCode ? ` (HTTP ${e.lastDelivery.statusCode})` : ''}`
                    : 'no deliveries yet'}{' '}
                  · last 7 days:{' '}
                  {Object.entries(e.last7d)
                    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
                    .join(', ') || 'none'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => test.mutate(e.id)} disabled={test.isPending || !e.enabled}>
                    Send test event
                  </Button>
                  <Button size="sm" onClick={() => setViewing(e)}>
                    Delivery log
                  </Button>
                  <Button size="sm" onClick={() => patch.mutate({ id: e.id, enabled: !e.enabled })}>
                    {e.enabled ? 'Switch off' : 'Switch on'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (window.confirm('Generate a new secret? The old one stops working immediately.'))
                        rotate.mutate(e.id);
                    }}
                  >
                    Rotate secret
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (window.confirm('Remove this endpoint and its delivery log?')) remove.mutate(e.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Webhook}
            title="No endpoints yet"
            description="Add an HTTPS URL and choose the events you want."
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                Add endpoint
              </Button>
            }
          />
        </Card>
      )}

      <Card className="mt-6">
        <CardBody className="space-y-2">
          <p className="text-[13px] font-medium">Verifying a request</p>
          <p className="text-helper">
            Each request carries <code className="font-mono">X-LeadPilot-Timestamp</code> and{' '}
            <code className="font-mono">X-LeadPilot-Signature: v1=&lt;hex&gt;</code>, the HMAC-SHA256 of{' '}
            <code className="font-mono">timestamp + &quot;.&quot; + raw body</code> with your secret. Reject requests
            whose timestamp is more than 5 minutes old. Bodies carry ids only; fetch details with the public API.
            Redirects are not followed, and private network addresses are refused.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12px] leading-5">{`const expected = 'v1=' + crypto.createHmac('sha256', SECRET)\n  .update(ts + '.' + rawBody).digest('hex');\nconst ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));`}</pre>
        </CardBody>
      </Card>

      <AddEndpointDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(sec) => setSecret(sec)}
      />

      <Secret value={secret} onClose={() => setSecret(null)} />
      <Deliveries endpoint={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
