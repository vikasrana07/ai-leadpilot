'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { API_SCOPES } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';
import { applyTerms } from '@/lib/terms-text';

interface Key {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  requestCount: number;
}

const SCOPE_HELP: Record<string, string> = {
  'leads:create': 'Send new leads (website form, ad platform). Works on every plan.',
  'leads:read': 'Read and search leads, notes and pipeline stages',
  'leads:write': 'Create and update leads, add notes, move stages, assign',
  'leads:delete': 'Delete leads (soft delete)',
  'conversations:read': 'Read conversations and messages',
  'appointments:read': 'Read appointments',
  'appointments:write': 'Book appointments',
};

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Key name is required').max(80, 'Key name cannot exceed 80 characters'),
  scopes: z.array(z.string()).min(1, 'Please select at least one permission scope'),
  days: z.string().optional(),
});

type CreateApiKeyValues = z.infer<typeof createApiKeySchema>;

function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: string) => void;
}) {
  const terms = useTerms();
  const qc = useQueryClient();
  const [upgrade, setUpgrade] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateApiKeyValues>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      name: '',
      scopes: ['leads:read'],
      days: '90',
    },
  });

  const selectedScopes = watch('scopes') ?? [];

  const toggleScope = (s: string) => {
    const next = selectedScopes.includes(s)
      ? selectedScopes.filter((x) => x !== s)
      : [...selectedScopes, s];
    setValue('scopes', next, { shouldValidate: true, shouldDirty: true });
  };

  const onSubmit = async (values: CreateApiKeyValues) => {
    setUpgrade(false);
    try {
      const res = await api<{ key: string }>('/api-keys', {
        method: 'POST',
        body: {
          name: values.name.trim(),
          scopes: values.scopes,
          ...(values.days ? { expiresInDays: Number(values.days) } : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: ['api-keys'] });
      reset();
      onOpenChange(false);
      onCreated(res.key);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setUpgrade(true);
      } else {
        handleApiError(e, setError);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          reset();
          setUpgrade(false);
        }
      }}
    >
      <DialogContent
        title="Create API key"
        description="Give the key only the access it needs. You can revoke it at any time."
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormErrorAlert errors={errors} />
          <Field label="Key Name *" htmlFor="k-name" error={errors.name?.message}>
            <Input
              id="k-name"
              placeholder="e.g. CRM sync"
              autoFocus
              maxLength={80}
              {...register('name')}
            />
          </Field>

          <fieldset className="space-y-1.5">
            <legend className="text-label mb-1.5">Access Scopes *</legend>
            {errors.scopes?.message ? (
              <p role="alert" className="text-helper !text-danger mb-1.5">
                {errors.scopes.message}
              </p>
            ) : null}
            <div className="space-y-2">
              {API_SCOPES.map((s) => (
                <label
                  key={s}
                  className="flex items-start gap-2.5 text-[13px] rounded-md p-1.5 hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedScopes.includes(s)}
                    onChange={() => toggleScope(s)}
                  />
                  <span className="min-w-0 flex-1">
                    <code className="font-mono text-[12px]">{s}</code>
                    <span className="text-helper block">{applyTerms(SCOPE_HELP[s] ?? '', terms)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Expires" htmlFor="k-exp" error={errors.days?.message}>
            <Select id="k-exp" {...register('days')}>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
              <option value="">Never</option>
            </Select>
          </Field>

          {upgrade ? (
            <p className="rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-[13px]">
              The public API is not included in your plan.{' '}
              <Link href="/billing" className="font-medium underline">
                See plans
              </Link>
              . {terms.Lead}-capture-only keys (<code>leads:create</code>) work on every plan.
            </p>
          ) : null}

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
              Create key
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const terms = useTerms();
  const { can } = useAuth();
  const qc = useQueryClient();
  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<Key[]>('/api-keys'),
    enabled: can('integration:manage'),
  });

  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Key revoked: it stops working immediately');
      await qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => handleApiError(e),
  });

  if (!can('integration:manage')) {
    return (
      <>
        <PageHeader title="API keys" />
        <Card>
          <EmptyState
            icon={KeyRound}
            title="Only workspace owners can manage API keys"
            description="Ask an owner to create a key for you."
          />
        </Card>
      </>
    );
  }

  const curl = `curl ${API_URL}/v1/leads?limit=5 \\\n  -H "Authorization: Bearer YOUR_KEY"`;

  return (
    <>
      <PageHeader
        title="API keys"
        description="Let your own systems read and write your LeadPilot data."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Create API key
          </Button>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <KeyRound className="mr-1.5 inline h-4 w-4" aria-hidden />
              Your keys
            </CardTitle>
            <a
              className="text-[13px] text-primary underline underline-offset-2 hover:no-underline"
              href={`${API_URL}/v1/openapi.json`}
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI description
            </a>
          </CardHeader>
          <CardBody className="p-0">
            {keys.isPending ? (
              <Skeleton className="m-4 h-16" />
            ) : keys.data && keys.data.length > 0 ? (
              <ul className="divide-y divide-border">
                {keys.data.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {k.name}{' '}
                        <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {k.keyPrefix}…
                        </code>
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} tone="primary" title={applyTerms(SCOPE_HELP[s] ?? '', terms)}>
                            {s}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-helper mt-1.5">
                        Created {timeAgo(k.createdAt)} ·{' '}
                        {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : 'never used'} ·{' '}
                        {k.requestCount.toLocaleString('en-IN')} requests ·{' '}
                        {k.expiresAt ? (
                          new Date(k.expiresAt) < new Date() ? (
                            <span className="text-danger">expired</span>
                          ) : (
                            `expires ${new Date(k.expiresAt).toLocaleDateString('en-IN')}`
                          )
                        ) : (
                          'no expiry'
                        )}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (window.confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`))
                          revoke.mutate(k.id);
                      }}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-helper p-4">No API keys yet.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick start</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12px] leading-5">
              {curl}
            </pre>
            <p className="text-helper">
              Keys act on your workspace only, with exactly the scopes you grant. Each key is limited to 120
              requests a minute. Send an <code className="font-mono">Idempotency-Key</code> header on POSTs so
              retries never create duplicates. The public API is included in Growth and Premium.{' '}
              <Link href="/webhooks" className="text-primary underline underline-offset-2">
                Set up webhooks
              </Link>{' '}
              to be told about events as they happen.
            </p>
          </CardBody>
        </Card>
      </div>

      <CreateApiKeyDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(k) => setFresh(k)}
      />

      <Dialog
        open={fresh !== null}
        onOpenChange={(o) => {
          if (!o) {
            setFresh(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent
          title="Copy your API key"
          description="This is the only time the full key is shown. Store it somewhere safe."
          size="md"
        >
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{fresh}</code>
            <Button
              size="sm"
              onClick={() => {
                if (fresh) void navigator.clipboard.writeText(fresh).then(() => setCopied(true));
              }}
              aria-label="Copy key"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                setFresh(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
