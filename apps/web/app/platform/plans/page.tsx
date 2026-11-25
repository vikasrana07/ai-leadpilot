'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Edit2,
  EyeOff,
  Plus,
  Users,
} from 'lucide-react';
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
  ent: Object.fromEntries(
    [...LIMIT_KEYS, ...FEATURE_KEYS].map((k) => [k, { enabled: true, limit: '' }])
  ),
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
    p.entitlements.map((e) => [
      e.key,
      { enabled: e.enabled, limit: e.limit === null ? '' : String(e.limit) },
    ])
  ),
});

const planFormSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,31}$/, 'Lowercase letters, digits, underscore (2-32 chars)'),
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
      toast.success('Plan configurations saved');
      onSaved();
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  return (
    <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
        <FormErrorAlert errors={errors} />

        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          <p className="text-[13px] font-semibold text-foreground">General Configuration</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan Identifier" htmlFor="pl-key" error={errors.key?.message} hint="lowercase_identifier">
              <Input
                id="pl-key"
                disabled={!draft.isNew}
                autoFocus={draft.isNew}
                placeholder="e.g. enterprise_growth"
                {...register('key')}
              />
            </Field>
            <Field label="Display Name" htmlFor="pl-name" error={errors.name?.message}>
              <Input
                id="pl-name"
                autoFocus={!draft.isNew}
                placeholder="e.g. Growth Tier"
                {...register('name')}
              />
            </Field>
          </div>

          <Field label="Short Description" htmlFor="pl-desc" error={errors.description?.message}>
            <Input id="pl-desc" placeholder="Who this plan is best suited for..." {...register('description')} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Price ₹ / Month (ex-GST)" htmlFor="pl-price" error={errors.priceRupees?.message}>
              <Input id="pl-price" inputMode="decimal" placeholder="4999" {...register('priceRupees')} />
            </Field>
            <Field label="Trial Period (Days)" htmlFor="pl-trial" error={errors.trialDays?.message}>
              <Input id="pl-trial" inputMode="numeric" placeholder="14" {...register('trialDays')} />
            </Field>
            <Field label="Sort Position" htmlFor="pl-sort" error={errors.sortOrder?.message}>
              <Input id="pl-sort" inputMode="numeric" placeholder="10" {...register('sortOrder')} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-5 pt-2 text-[13px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded" {...register('isPublic')} />
              <span>Public (Visible on workspace upgrade page)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded" {...register('active')} />
              <span>Active (Available for assignment)</span>
            </label>
          </div>
        </div>

        {/* Quota Limits */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-foreground">Usage Quota Limits</p>
            <span className="text-[11px] text-muted-foreground">Empty or blank input = Unlimited (∞)</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {LIMIT_KEYS.map((k) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-muted/30 p-2.5 text-[13px]"
              >
                <label className="flex items-center gap-2 font-medium text-foreground cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    className="rounded"
                    aria-label={`${ENTITLEMENT_LABELS[k]} enabled`}
                    checked={ent[k]?.enabled ?? false}
                    onChange={(e) => setEntitlement(k, { enabled: e.target.checked })}
                  />
                  <span>{ENTITLEMENT_LABELS[k]}</span>
                </label>
                <Input
                  className="h-8 w-28 text-right font-mono text-[12px]"
                  inputMode="numeric"
                  placeholder="∞"
                  aria-label={`${ENTITLEMENT_LABELS[k]} limit`}
                  value={ent[k]?.limit ?? ''}
                  onChange={(e) =>
                    setEntitlement(k, { limit: e.target.value.replace(/\D/g, '') })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* Feature Entitlements */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-[13px] font-semibold text-foreground">Feature Entitlements</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {FEATURE_KEYS.map((k) => (
              <label
                key={k}
                className="flex items-center gap-2.5 rounded-md border border-border/60 p-2 text-[13px] text-foreground cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <input
                  type="checkbox"
                  className="rounded"
                  checked={ent[k]?.enabled ?? false}
                  onChange={(e) => setEntitlement(k, { enabled: e.target.checked })}
                />
                <span className="font-medium">{ENTITLEMENT_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {draft.isNew ? 'Create Plan' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}

export default function PlatformPlans() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => platformApi<PlatformPlan[]>('/plans'),
  });
  const [d, setD] = useState<Draft | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription Plans & Tiers"
        description="Configure pricing, resource quota limits, and platform features. Limit adjustments propagate to existing workspaces in real time."
        actions={
          <Button variant="primary" onClick={() => setD(blank())}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Plan
          </Button>
        }
      />

      {q.isPending ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-8 w-24" />
              <div className="space-y-2 pt-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {q.data?.map((p) => (
            <Card
              key={p.key}
              className="flex flex-col justify-between transition-all hover:border-border-strong hover:shadow-md"
            >
              <div>
                <CardHeader className="flex items-start justify-between pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-[17px]">{p.name}</CardTitle>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {p.key}
                      </span>
                    </div>
                    {p.description ? (
                      <p className="text-helper mt-1 text-[12px]">{p.description}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!p.active && <Badge tone="danger">Inactive</Badge>}
                    {!p.isPublic && (
                      <Badge tone="neutral" className="flex items-center gap-1">
                        <EyeOff className="h-3 w-3" />
                        Hidden
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardBody className="space-y-4 pt-0">
                  {/* Price Hero Section */}
                  <div className="rounded-lg bg-muted/40 p-3.5 border border-border/50">
                    <div className="flex items-baseline gap-1.5">
                      <span className="num text-[26px] font-bold tracking-tight text-foreground">
                        {inr(p.priceMinor)}
                      </span>
                      <span className="text-[12px] text-muted-foreground">/ month</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {inr(p.priceWithGstMinor)} incl. 18% GST · {p.trialDays}-day trial
                    </p>
                    <div className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-primary">
                      <Users className="h-3.5 w-3.5" />
                      <span>
                        {p.tenants} {p.tenants === 1 ? 'workspace' : 'workspaces'} enrolled
                      </span>
                    </div>
                  </div>

                  {/* Resource Limits List */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Resource Quotas
                    </p>
                    <ul className="space-y-1.5 text-[12px]">
                      {p.entitlements
                        .filter((e) => (LIMIT_KEYS as readonly string[]).includes(e.key))
                        .map((e) => (
                          <li
                            key={e.key}
                            className="flex items-center justify-between py-0.5 border-b border-border/40 pb-1"
                          >
                            <span className="text-muted-foreground">
                              {ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS]}
                            </span>
                            <span className="num font-semibold text-foreground">
                              {e.enabled ? limitText(e.limit) : 'Disabled'}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>

                  {/* Features Badges */}
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Included Capabilities
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {p.entitlements
                        .filter((e) => (FEATURE_KEYS as readonly string[]).includes(e.key))
                        .map((e) => (
                          <Badge
                            key={e.key}
                            tone={e.enabled ? 'success' : 'neutral'}
                            className="text-[11px]"
                          >
                            {e.enabled ? (
                              <Check className="h-3 w-3 mr-1 text-emerald-500" />
                            ) : null}
                            {ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS]}
                          </Badge>
                        ))}
                    </div>
                  </div>
                </CardBody>
              </div>

              <div className="border-t border-border p-4">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full justify-center"
                  onClick={() => setD(fromPlan(p))}
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                  Configure Plan
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Plan Drawer Modal */}
      <Dialog
        open={d !== null}
        onOpenChange={(o) => {
          if (!o) setD(null);
        }}
      >
        <DialogContent
          title={d?.isNew ? 'Create New Subscription Plan' : `Configure Plan: ${d?.name ?? ''}`}
          description="Plan parameters and resource quotas. Price changes apply to future subscriptions; grandfathered workspaces retain their rate."
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
    </div>
  );
}
