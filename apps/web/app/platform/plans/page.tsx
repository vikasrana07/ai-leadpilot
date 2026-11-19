'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { handleApiError } from '@/lib/forms';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, inr, limitText } from '@/lib/billing';
import { platformApi, type PlatformPlan } from '@/lib/platform';

interface Draft {
  key: string;
  name: string;
  description: string;
  priceRupees: string;
  trialDays: string;
  isPublic: boolean;
  active: boolean;
  sortOrder: string;
  ent: Record<string, { enabled: boolean; limit: string }>;
  isNew: boolean;
}

const blank = (): Draft => ({
  key: '',
  name: '',
  description: '',
  priceRupees: '',
  trialDays: '14',
  isPublic: true,
  active: true,
  sortOrder: '100',
  isNew: true,
  ent: Object.fromEntries([...LIMIT_KEYS, ...FEATURE_KEYS].map((k) => [k, { enabled: true, limit: '' }])),
});

const fromPlan = (p: PlatformPlan): Draft => ({
  key: p.key,
  name: p.name,
  description: p.description,
  priceRupees: String(p.priceMinor / 100),
  trialDays: String(p.trialDays),
  isPublic: p.isPublic,
  active: p.active,
  sortOrder: String(p.sortOrder),
  isNew: false,
  ent: Object.fromEntries(
    p.entitlements.map((e) => [e.key, { enabled: e.enabled, limit: e.limit === null ? '' : String(e.limit) }]),
  ),
});

const planFormSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,31}$/, 'Lowercase letters, digits, underscore (2-32 chars)'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  priceRupees: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid price in ₹'),
  trialDays: z.string().trim().regex(/^\d+$/, 'Enter number of trial days'),
  sortOrder: z.string().trim().regex(/^\d+$/, 'Enter sort order'),
  isPublic: z.boolean(),
  active: z.boolean(),
});

type PlanFormValues = z.infer<typeof planFormSchema>;

function PlanDrawerForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ent, setEnt] = useState(draft.ent);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: {
      key: draft.key,
      name: draft.name,
      description: draft.description,
      priceRupees: draft.priceRupees,
      trialDays: draft.trialDays,
      sortOrder: draft.sortOrder,
      isPublic: draft.isPublic,
      active: draft.active,
    },
  });

  const setEntitlement = (k: string, patch: Partial<{ enabled: boolean; limit: string }>) =>
    setEnt((prev) => ({
      ...prev,
      [k]: { enabled: true, limit: '', ...prev[k], ...patch },
    }));

  async function onSubmit(x: PlanFormValues) {
    try {
      const body = {
        name: x.name,
        description: x.description || '',
        priceMinor: Math.round(Number(x.priceRupees) * 100),
        trialDays: Number(x.trialDays || 0),
        isPublic: x.isPublic,
        active: x.active,
        sortOrder: Number(x.sortOrder || 0),
        entitlements: [...LIMIT_KEYS, ...FEATURE_KEYS].map((k) => ({
          key: k,
          enabled: ent[k]?.enabled ?? false,
          limit:
            (LIMIT_KEYS as readonly string[]).includes(k) && ent[k]?.limit !== '' && ent[k]
              ? Number(ent[k].limit)
              : null,
        })),
      };
      if (draft.isNew) {
        await platformApi('/plans', { method: 'POST', body: { key: x.key, ...body } });
      } else {
        await platformApi(`/plans/${draft.key}`, { method: 'PATCH', body });
      }
      toast.success('Plan saved');
      onSaved();
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  return (
    <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-3.5">
        <FormErrorAlert errors={errors} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key" htmlFor="pl-key" error={errors.key?.message} hint="lowercase, digits, underscore">
            <Input id="pl-key" disabled={!draft.isNew} autoFocus={draft.isNew} {...register('key')} />
          </Field>
          <Field label="Name" htmlFor="pl-name" error={errors.name?.message}>
            <Input id="pl-name" autoFocus={!draft.isNew} {...register('name')} />
          </Field>
        </div>
        <Field label="Description" htmlFor="pl-desc" error={errors.description?.message}>
          <Input id="pl-desc" {...register('description')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Price ₹ / month (ex-GST)" htmlFor="pl-price" error={errors.priceRupees?.message}>
            <Input id="pl-price" inputMode="decimal" {...register('priceRupees')} />
          </Field>
          <Field label="Trial days" htmlFor="pl-trial" error={errors.trialDays?.message}>
            <Input id="pl-trial" inputMode="numeric" {...register('trialDays')} />
          </Field>
          <Field label="Sort order" htmlFor="pl-sort" error={errors.sortOrder?.message}>
            <Input id="pl-sort" inputMode="numeric" {...register('sortOrder')} />
          </Field>
        </div>
        <div className="flex gap-4 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('isPublic')} />
            Public (shown on the billing page)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('active')} />
            Active
          </label>
        </div>
        <fieldset className="rounded-md border border-border p-3">
          <legend className="text-label px-1">Limits (empty = unlimited)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {LIMIT_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  aria-label={`${ENTITLEMENT_LABELS[k]} enabled`}
                  checked={ent[k]?.enabled ?? false}
                  onChange={(e) => setEntitlement(k, { enabled: e.target.checked })}
                />
                <span className="flex-1">{ENTITLEMENT_LABELS[k]}</span>
                <Input
                  className="h-8 w-28"
                  inputMode="numeric"
                  placeholder="∞"
                  aria-label={`${ENTITLEMENT_LABELS[k]} limit`}
                  value={ent[k]?.limit ?? ''}
                  onChange={(e) => setEntitlement(k, { limit: e.target.value.replace(/\D/g, '') })}
                />
              </div>
            ))}
          </div>
        </fieldset>
        <fieldset className="rounded-md border border-border p-3">
          <legend className="text-label px-1">Features</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURE_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={ent[k]?.enabled ?? false}
                  onChange={(e) => setEntitlement(k, { enabled: e.target.checked })}
                />
                {ENTITLEMENT_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          Save plan
        </Button>
      </div>
    </form>
  );
}

export default function PlatformPlans() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-plans'], queryFn: () => platformApi<PlatformPlan[]>('/plans') });
  const [d, setD] = useState<Draft | null>(null);

  return (
    <>
      <PageHeader
        title="Plans"
        description="Plans and limits are data. Limit changes reach existing customers immediately."
        actions={<Button variant="primary" onClick={() => setD(blank())}>New plan</Button>}
      />
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data?.map((p) => (
            <Card key={p.key}>
              <CardHeader>
                <div>
                  <CardTitle>
                    {p.name} <span className="text-helper font-normal">({p.key})</span>
                  </CardTitle>
                  <p className="text-helper mt-0.5">
                    {inr(p.priceMinor)} + GST = {inr(p.priceWithGstMinor)} · {p.tenants} workspaces · {p.trialDays}-day trial
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {p.active ? null : <Badge tone="danger">Inactive</Badge>}
                  {p.isPublic ? null : <Badge>Hidden</Badge>}
                </div>
              </CardHeader>
              <CardBody>
                <ul className="mb-3 space-y-1 text-[13px]">
                  {p.entitlements
                    .filter((e) => (LIMIT_KEYS as readonly string[]).includes(e.key))
                    .map((e) => (
                      <li key={e.key} className="flex justify-between">
                        <span className="text-muted-foreground">{ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS]}</span>
                        <span className="num">{e.enabled ? limitText(e.limit) : 'Off'}</span>
                      </li>
                    ))}
                </ul>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {p.entitlements
                    .filter((e) => (FEATURE_KEYS as readonly string[]).includes(e.key))
                    .map((e) => (
                      <Badge key={e.key} tone={e.enabled ? 'success' : 'neutral'}>
                        {ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS]}
                      </Badge>
                    ))}
                </div>
                <Button size="sm" onClick={() => setD(fromPlan(p))}>
                  Edit
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={d !== null} onOpenChange={(o) => { if (!o) setD(null); }}>
        <DialogContent
          title={d?.isNew ? 'New plan' : `Edit ${d?.name ?? ''}`}
          description="Price changes only affect new subscribers: existing customers keep the price they signed up at."
          size="2xl"
        >
          {d ? (
            <PlanDrawerForm
              draft={d}
              onClose={() => setD(null)}
              onSaved={() => {
                setD(null);
                void qc.invalidateQueries({ queryKey: ['platform-plans'] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
