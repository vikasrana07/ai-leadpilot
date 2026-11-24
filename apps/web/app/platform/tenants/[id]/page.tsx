'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  AlertOctagon,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Mail,
  Receipt,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sparkles,
  User,
  Users,
  Zap,
} from 'lucide-react';
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
import { Avatar } from '@/components/ui/avatar';
import { PlatformProgressBar } from '@/components/platform/platform-progress-bar';
import { ApiError } from '@/lib/api';
import { handleApiError } from '@/lib/forms';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, fmtDate, inr } from '@/lib/billing';
import { platformApi, type PlatformPlan, type PlatformTenantDetail } from '@/lib/platform';

type Action = 'suspend' | 'reactivate' | 'plan' | null;

const tenantActionSchema = z.object({
  planKey: z.string().optional(),
  mode: z.enum(['complimentary', 'trial']).optional(),
  days: z.string().optional(),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
});

type TenantActionFormValues = z.infer<typeof tenantActionSchema>;

function TenantActionDialog({
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
      toast.success('Action completed. Recorded in both audit logs.');
      onSuccess();
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={
          action === 'suspend'
            ? 'Suspend Workspace'
            : action === 'reactivate'
              ? 'Reactivate Workspace'
              : 'Assign Plan to Workspace'
        }
        description="A clear reason is required for compliance. It is recorded in the platform audit log and the workspace's audit log."
        size="md"
      >
        <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            <FormErrorAlert errors={errors} />

            {action === 'plan' ? (
              <>
                <Field label="Target Plan" htmlFor="ap-plan" error={errors.planKey?.message}>
                  <Select id="ap-plan" {...register('planKey')}>
                    {plans.filter((p) => p.active).map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name} ({p.key})
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Assignment Mode" htmlFor="ap-mode" error={errors.mode?.message}>
                    <Select id="ap-mode" {...register('mode')}>
                      <option value="complimentary">Complimentary</option>
                      <option value="trial">Trial</option>
                    </Select>
                  </Field>

                  <Field
                    label="Duration (Days)"
                    htmlFor="ap-days"
                    hint={mode === 'trial' ? 'Required for trial' : 'Blank = indefinite'}
                    error={errors.days?.message}
                  >
                    <Input id="ap-days" inputMode="numeric" placeholder={mode === 'trial' ? '14' : '∞'} {...register('days')} />
                  </Field>
                </div>
              </>
            ) : null}

            {action === 'suspend' && (
              <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">
                <p className="font-semibold">Workspace suspension warning</p>
                <p className="mt-0.5 text-[12px] opacity-90">
                  Suspension immediately halts all automated campaigns, webhook triggers, and revokes workspace user access.
                </p>
              </div>
            )}

            <Field label="Reason for this action" htmlFor="ap-reason" error={errors.reason?.message}>
              <Textarea
                id="ap-reason"
                rows={3}
                autoFocus
                {...register('reason')}
                placeholder="Explain why this change is being made (e.g., requested via support ticket #1234)..."
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={action === 'suspend' ? 'danger' : 'primary'}
              loading={isSubmitting}
            >
              {action === 'suspend' ? 'Confirm Suspension' : action === 'reactivate' ? 'Reactivate Workspace' : 'Apply Plan'}
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
  const q = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => platformApi<PlatformTenantDetail>(`/tenants/${id}`),
    retry: false,
  });
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => platformApi<PlatformPlan[]>('/plans'),
  });
  const [action, setAction] = useState<Action>(null);

  if (q.isPending) return <PlatformTenantDetailSkeleton />;
  if (q.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Workspace Details" breadcrumbs={[{ label: 'Tenants', href: '/platform/tenants' }]} />
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            {q.error instanceof ApiError && q.error.status === 404
              ? 'Workspace not found.'
              : 'Could not load this workspace.'}
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <a href="/platform/tenants">Back to Tenants</a>
          </Button>
        </Card>
      </div>
    );
  }

  const d = q.data;
  const t = d.tenant;
  const e = d.entitlements;
  const s = d.subscription;
  const suspended = t.status === 'SUSPENDED';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.name}
        breadcrumbs={[{ label: 'Tenants', href: '/platform/tenants' }, { label: t.name }]}
        description={`${t.email} · ${t.industry || 'General Industry'} · Created ${fmtDate(t.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SupportAccessButton tenantId={id} />
            <Button variant="secondary" onClick={() => setAction('plan')}>
              <CreditCard className="h-4 w-4 mr-1.5" />
              Assign Plan
            </Button>
            {suspended ? (
              <Button variant="primary" onClick={() => setAction('reactivate')}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Reactivate
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setAction('suspend')}>
                <AlertOctagon className="h-4 w-4 mr-1.5" />
                Suspend
              </Button>
            )}
          </div>
        }
      />

      {/* Status Alert Banner if Suspended */}
      {suspended && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-[13px] text-danger">
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">This workspace is currently suspended</p>
            <p className="mt-0.5 text-[12px] opacity-90">
              User logins are blocked and all background automation runs are halted. You can reactivate this workspace once the underlying billing or policy issue is resolved.
            </p>
          </div>
        </div>
      )}

      {/* Main Details Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subscription & Billing Overview */}
        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              <CardTitle>Subscription Status</CardTitle>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge tone={suspended ? 'danger' : 'success'}>
                {t.status}
              </Badge>
              <Badge tone="primary">
                {e.planName}
              </Badge>
            </div>
          </CardHeader>
          <CardBody className="divide-y divide-border text-[13px] flex-1">
            {[
              ['Entitlement Status', e.status + (e.restricted ? ' (read-only mode)' : '')],
              ['Billing Provider', s?.provider ? s.provider.toUpperCase() : 'NONE (Direct)'],
              ['Trial Expiration', fmtDate(s?.trialEndsAt)],
              ['Current Period End', fmtDate(s?.currentPeriodEnd)],
              ['Grace Period End', fmtDate(s?.graceEndsAt)],
              ['Pending Plan Switch', s?.pendingPlanKey ?? '—'],
              ['Cancels at Period End', s?.cancelAtPeriodEnd ? 'Yes (Scheduled)' : 'No'],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between py-2.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{val}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Workspace Owners & Staff Access */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <CardTitle>Workspace Owners</CardTitle>
            </div>
            <span className="num text-[12px] text-muted-foreground">
              {d.owners.length} {d.owners.length === 1 ? 'Owner' : 'Owners'}
            </span>
          </CardHeader>
          <CardBody className="space-y-3 flex-1">
            {d.owners.map((o) => (
              <div
                key={o.email}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={o.name} size={36} />
                  <div>
                    <p className="font-semibold text-foreground">{o.name}</p>
                    <p className="text-[12px] text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {o.email}
                    </p>
                  </div>
                </div>
                <Badge tone="neutral">Primary Admin</Badge>
              </div>
            ))}

            <div className="rounded-lg border border-border p-3.5 mt-4 bg-muted/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-foreground">Support Session Access</p>
                  <p className="text-helper mt-0.5">
                    Temporarily impersonate workspace view for troubleshooting.
                  </p>
                </div>
                <SupportAccessButton tenantId={id} />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Entitlements & Capacity Quotas */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <CardTitle>Entitlements & Usage Quotas</CardTitle>
            </div>
            <p className="text-helper text-[12px]">
              Actual consumption against plan limits for {e.planName}
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            {/* Visual Quota Capacity Meters */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {LIMIT_KEYS.map((k) => (
                <div
                  key={k}
                  className="rounded-lg border border-border bg-card p-4 shadow-2xs"
                >
                  <PlatformProgressBar
                    label={ENTITLEMENT_LABELS[k]}
                    value={d.usage[k]}
                    limit={e.limits[k]}
                  />
                </div>
              ))}
            </div>

            {/* Feature Flags Section */}
            <div className="pt-2">
              <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                Enabled Platform Features
              </p>
              <div className="flex flex-wrap gap-2">
                {FEATURE_KEYS.map((k) => (
                  <Badge
                    key={k}
                    tone={e.features[k] ? 'success' : 'neutral'}
                    className="px-2.5 py-1 text-[12px]"
                  >
                    {e.features[k] ? (
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    ) : null}
                    {ENTITLEMENT_LABELS[k]}
                  </Badge>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Invoices */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              <CardTitle>Recent Invoices</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {d.invoices.length === 0 ? (
              <p className="py-6 text-center text-helper">No billing invoices issued yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {d.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between py-2.5 text-[13px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono font-medium text-foreground">
                        {inv.number}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground text-[12px]">
                        {fmtDate(inv.issuedAt)}
                      </span>
                      <span className="num font-semibold text-foreground">
                        {inr(inv.totalMinor)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recent Workspace Activity */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle>Recent Workspace Events</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {d.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-helper">No recent activity recorded.</p>
            ) : (
              <div className="space-y-3">
                {d.recentActivity.slice(0, 8).map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b border-border/60 pb-2.5 last:border-0 last:pb-0 text-[12px]"
                  >
                    <span className="font-mono font-medium text-foreground bg-muted/60 px-2 py-0.5 rounded">
                      {a.action}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(a.at).toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {action ? (
        <TenantActionDialog
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
    </div>
  );
}
