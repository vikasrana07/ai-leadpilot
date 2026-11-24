'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { SupportAccessButton } from '@/components/support/support-start';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PlatformTenantDetailSkeleton } from '@/components/skeletons';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { handleApiError } from '@/lib/forms';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, fmtDate, inr, limitText } from '@/lib/billing';
import { platformApi, type PlatformPlan, type PlatformTenantDetail } from '@/lib/platform';

type Action = 'suspend' | 'reactivate' | 'plan' | null;

const tenantActionSchema = z.object({
  planKey: z.string().optional(),
  mode: z.enum(['complimentary', 'trial']).optional(),
  days: z.string().optional(),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
});

type TenantActionFormValues = z.infer<typeof tenantActionSchema>;

function TenantActionDrawer({
  action,
  tenantId,
  plans,
  onClose,
  onSuccess,
}: {
  action: 'suspend' | 'reactivate' | 'plan';
  tenantId: string;
  plans: PlatformPlan[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TenantActionFormValues>({
    resolver: zodResolver(tenantActionSchema),
    defaultValues: {
      planKey: plans.find((p) => p.active)?.key ?? 'growth',
      mode: 'complimentary',
      days: '30',
      reason: '',
    },
  });

  const mode = watch('mode');

  async function onSubmit(data: TenantActionFormValues) {
    try {
      if (action === 'plan') {
        await platformApi(`/tenants/${tenantId}/plan`, {
          method: 'POST',
          body: {
            planKey: data.planKey,
            mode: data.mode,
            reason: data.reason,
            ...(data.days ? { days: Number(data.days) } : {}),
          },
        });
      } else {
        await platformApi(`/tenants/${tenantId}/${action}`, {
          method: 'POST',
          body: { reason: data.reason },
        });
      }
      toast.success('Done. Recorded in both audit logs.');
      onSuccess();
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={action === 'suspend' ? 'Suspend workspace' : action === 'reactivate' ? 'Reactivate workspace' : 'Assign plan'}
        description="A reason is required. It is written to the platform audit log and the workspace's own audit log."
        size="md"
      >
        <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-3.5">
            <FormErrorAlert errors={errors} />
            {action === 'plan' ? (
              <>
                <Field label="Plan" htmlFor="ap-plan" error={errors.planKey?.message}>
                  <Select id="ap-plan" {...register('planKey')}>
                    {plans.filter((p) => p.active).map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Type" htmlFor="ap-mode" error={errors.mode?.message}>
                    <Select id="ap-mode" {...register('mode')}>
                      <option value="complimentary">Complimentary</option>
                      <option value="trial">Trial</option>
                    </Select>
                  </Field>
                  <Field label="Days" htmlFor="ap-days" hint={mode === 'trial' ? 'Required' : 'Empty = no end date'} error={errors.days?.message}>
                    <Input id="ap-days" inputMode="numeric" {...register('days')} />
                  </Field>
                </div>
              </>
            ) : null}
            <Field label="Reason" htmlFor="ap-reason" error={errors.reason?.message}>
              <Textarea id="ap-reason" rows={3} autoFocus {...register('reason')} placeholder="Reason for audit log..." />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={action === 'suspend' ? 'danger' : 'primary'} loading={isSubmitting}>
              Confirm
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PlatformTenant() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-tenant', id], queryFn: () => platformApi<PlatformTenantDetail>(`/tenants/${id}`), retry: false });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => platformApi<PlatformPlan[]>('/plans') });
  const [action, setAction] = useState<Action>(null);

  if (q.isPending) return <PlatformTenantDetailSkeleton />;
  if (q.isError) return <><PageHeader title="Workspace" /><p className="text-helper">{q.error instanceof ApiError && q.error.status === 404 ? 'Workspace not found.' : 'Could not load this workspace.'}</p></>;
  const d = q.data; const t = d.tenant; const e = d.entitlements; const s = d.subscription;
  const suspended = t.status === 'SUSPENDED';
  return (
    <>
      <PageHeader title={t.name} breadcrumbs={[{ label: 'Tenants', href: '/platform/tenants' }, { label: t.name }]} description={`${t.email} · ${t.industry} · created ${fmtDate(t.createdAt)}`}
        actions={<><Button onClick={() => setAction('plan')}>Assign plan</Button>{suspended ? <Button variant="primary" onClick={() => setAction('reactivate')}>Reactivate</Button> : <Button variant="danger" onClick={() => setAction('suspend')}>Suspend</Button>}</>} />
      <div className="mb-3 flex justify-end"><SupportAccessButton tenantId={id} /></div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Subscription</CardTitle><div className="flex gap-1.5"><Badge tone={suspended ? 'danger' : 'success'}>{t.status}</Badge><Badge>{e.planName}</Badge></div></CardHeader><CardBody className="divide-y divide-border text-[13px]">
          {[['Status', e.status + (e.restricted ? ' (read-only)' : '')], ['Provider', s?.provider ?? 'none'], ['Trial ends', fmtDate(s?.trialEndsAt)], ['Period ends', fmtDate(s?.currentPeriodEnd)], ['Grace ends', fmtDate(s?.graceEndsAt)], ['Pending plan', s?.pendingPlanKey ?? '—'], ['Cancel at period end', s?.cancelAtPeriodEnd ? 'Yes' : 'No']].map(([l, v]) => <div key={l} className="flex justify-between py-1.5"><span className="text-muted-foreground">{l}</span><span>{v}</span></div>)}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Owners</CardTitle></CardHeader><CardBody className="space-y-1 text-[13px]">{d.owners.map((o) => <div key={o.email}>{o.name} <span className="text-muted-foreground">{o.email}</span></div>)}</CardBody></Card>
        <Card><CardHeader><CardTitle>Entitlements &amp; usage</CardTitle></CardHeader><CardBody className="space-y-1.5 text-[13px]">
          {LIMIT_KEYS.map((k) => <div key={k} className="flex justify-between"><span className="text-muted-foreground">{ENTITLEMENT_LABELS[k]}</span><span className="num">{d.usage[k].toLocaleString('en-IN')} / {limitText(e.limits[k])}</span></div>)}
          <div className="flex flex-wrap gap-1.5 pt-2">{FEATURE_KEYS.map((k) => <Badge key={k} tone={e.features[k] ? 'success' : 'neutral'}>{ENTITLEMENT_LABELS[k]}</Badge>)}</div>
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Recent invoices</CardTitle></CardHeader><CardBody className="space-y-1 text-[13px]">{d.invoices.length ? d.invoices.map((i) => <div key={i.id} className="flex justify-between"><span className="num">{i.number}</span><span>{fmtDate(i.issuedAt)} · {inr(i.totalMinor)}</span></div>) : <span className="text-helper">None</span>}</CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader><CardTitle>Recent activity in the workspace</CardTitle></CardHeader><CardBody className="space-y-1 text-[13px]">{d.recentActivity.map((a, i) => <div key={i} className="flex justify-between"><span className="font-mono text-[12px]">{a.action}</span><span className="text-muted-foreground">{new Date(a.at).toLocaleString('en-IN')}</span></div>)}</CardBody></Card>
      </div>

      {action ? (
        <TenantActionDrawer
          action={action}
          tenantId={id}
          plans={plans.data ?? []}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setAction(null);
            void qc.invalidateQueries({ queryKey: ['platform-tenant', id] });
            void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
          }}
        />
      ) : null}
    </>
  );
}
