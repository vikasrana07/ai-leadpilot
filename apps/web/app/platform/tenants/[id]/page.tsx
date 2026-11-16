'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SupportAccessButton } from '@/components/support/support-start';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, fmtDate, inr, limitText } from '@/lib/billing';
import { platformApi, type PlatformPlan, type PlatformTenantDetail } from '@/lib/platform';

type Action = 'suspend' | 'reactivate' | 'plan' | null;

export default function PlatformTenant() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-tenant', id], queryFn: () => platformApi<PlatformTenantDetail>(`/tenants/${id}`), retry: false });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => platformApi<PlatformPlan[]>('/plans') });
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState(''); const [planKey, setPlanKey] = useState('growth'); const [mode, setMode] = useState<'complimentary' | 'trial'>('complimentary'); const [days, setDays] = useState('30');
  const m = useMutation({
    mutationFn: () => action === 'plan'
      ? platformApi(`/tenants/${id}/plan`, { method: 'POST', body: { planKey, mode, reason, ...(days ? { days: Number(days) } : {}) } })
      : platformApi(`/tenants/${id}/${action}`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success('Done. Recorded in both audit logs.'); setAction(null); setReason(''); void qc.invalidateQueries({ queryKey: ['platform-tenant', id] }); void qc.invalidateQueries({ queryKey: ['platform-tenants'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? (e.details?.[0]?.message ?? e.message) : 'Failed'),
  });
  if (q.isPending) return <><PageHeader title="Workspace" /><Skeleton className="h-64" /></>;
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

      <Dialog open={action !== null} onOpenChange={(o) => { if (!o) setAction(null); }}>
        <DialogContent title={action === 'suspend' ? 'Suspend workspace' : action === 'reactivate' ? 'Reactivate workspace' : 'Assign plan'} description="A reason is required. It is written to the platform audit log and the workspace's own audit log.">
          <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); m.mutate(); }}>
            {action === 'plan' ? <>
              <Field label="Plan" htmlFor="ap-plan"><Select id="ap-plan" value={planKey} onChange={(x) => setPlanKey(x.target.value)}>{plans.data?.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type" htmlFor="ap-mode"><Select id="ap-mode" value={mode} onChange={(x) => setMode(x.target.value as 'complimentary' | 'trial')}><option value="complimentary">Complimentary</option><option value="trial">Trial</option></Select></Field>
                <Field label="Days" htmlFor="ap-days" hint={mode === 'trial' ? 'Required' : 'Empty = no end date'}><Input id="ap-days" inputMode="numeric" value={days} onChange={(x) => setDays(x.target.value.replace(/\D/g, ''))} /></Field>
              </div></> : null}
            <Field label="Reason" htmlFor="ap-reason"><Textarea id="ap-reason" rows={3} value={reason} onChange={(x) => setReason(x.target.value)} minLength={5} required /></Field>
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setAction(null)}>Cancel</Button><Button type="submit" variant={action === 'suspend' ? 'danger' : 'primary'} loading={m.isPending} disabled={reason.trim().length < 5}>Confirm</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
