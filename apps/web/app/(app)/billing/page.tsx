'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, FlaskConical, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { BILLING_KEY } from '@/components/shell/billing-banner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, STATE_CODES, STATUS_LABEL, STATUS_TONE, daysLeft, fmtDate, inr, limitText, problemList, type BillingProfile, type BillingSummary, type CheckoutInit, type Invoice, type PlanView } from '@/lib/billing';
import { cn } from '@/lib/cn';

interface RazorpayCtor { new (o: Record<string, unknown>): { open: () => void } }

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('checkout unavailable')));
    s.onerror = () => reject(new Error('Could not load the payment window'));
    document.head.appendChild(s);
  });
}

const rank = (plans: PlanView[], key: string) => plans.find((p) => p.key === key)?.priceMinor ?? 0;

function ProfileDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const q = useQuery({ queryKey: ['billing-profile'], queryFn: () => api<BillingProfile | null>('/billing/profile'), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Billing details" description="Printed on your GST invoices. GSTIN is optional." className="max-w-lg">
        {q.isPending ? <Skeleton className="h-48" /> : <ProfileForm initial={q.data ?? null} onSaved={() => { onOpenChange(false); onSaved(); }} />}
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({ initial, onSaved }: { initial: BillingProfile | null; onSaved: () => void }) {
  const [v, setV] = useState<BillingProfile>(initial ?? { legalName: '', gstin: null, stateCode: '29', addressLine: '', city: '', pincode: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api('/billing/profile', { method: 'PUT', body: { ...v, gstin: v.gstin?.trim() ? v.gstin.trim().toUpperCase() : null } }),
    onSuccess: () => { toast.success('Billing details saved'); onSaved(); },
    onError: (e) => {
      if (e instanceof ApiError && e.details?.length) setErrors(Object.fromEntries(e.details.map((d) => [d.path || 'form', d.message])));
      else toast.error(e instanceof ApiError ? e.message : 'Could not save');
    },
  });
  const set = (k: keyof BillingProfile, val: string) => setV((x) => ({ ...x, [k]: val }));
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setErrors({}); m.mutate(); }}>
      <Field label="Legal / business name" htmlFor="bp-name" error={errors.legalName}><Input id="bp-name" value={v.legalName} onChange={(e) => set('legalName', e.target.value)} required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="GSTIN (optional)" htmlFor="bp-gstin" error={errors.gstin} hint="15 characters"><Input id="bp-gstin" value={v.gstin ?? ''} maxLength={15} onChange={(e) => setV((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} /></Field>
        <Field label="State" htmlFor="bp-state" error={errors.stateCode}>
          <Select id="bp-state" value={v.stateCode} onChange={(e) => set('stateCode', e.target.value)}>{Object.entries(STATE_CODES).map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</Select>
        </Field>
      </div>
      <Field label="Address" htmlFor="bp-addr" error={errors.addressLine}><Input id="bp-addr" value={v.addressLine} onChange={(e) => set('addressLine', e.target.value)} required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="City" htmlFor="bp-city"><Input id="bp-city" value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Pincode" htmlFor="bp-pin" error={errors.pincode}><Input id="bp-pin" value={v.pincode} inputMode="numeric" maxLength={6} onChange={(e) => set('pincode', e.target.value)} /></Field>
      </div>
      <div className="flex justify-end pt-1"><Button type="submit" variant="primary" loading={m.isPending}>Save details</Button></div>
    </form>
  );
}

function PlanCard({ plan, summary, plans, busy, onChoose }: { plan: PlanView; summary: BillingSummary; plans: PlanView[]; busy: boolean; onChoose: () => void }) {
  const paid = summary.provider.hasPaymentMethod && (summary.status === 'ACTIVE' || summary.status === 'PAST_DUE');
  const current = plan.key === summary.planKey && !summary.restricted;
  const pending = summary.pendingPlanKey === plan.key;
  const up = plan.priceMinor > rank(plans, summary.planKey);
  const label = pending ? 'Scheduled' : current && paid ? 'Current plan' : paid ? (up ? 'Upgrade' : 'Downgrade at cycle end') : 'Subscribe';
  const gst = plan.priceWithGstMinor - plan.priceMinor;
  return (
    <Card className={cn('flex flex-col', current && 'border-primary')}>
      <CardHeader><div><CardTitle>{plan.name}</CardTitle><p className="text-helper mt-0.5">{plan.description}</p></div>{current ? <Badge tone="primary">Your plan</Badge> : null}</CardHeader>
      <CardBody className="flex flex-1 flex-col">
        <p className="num text-[22px] font-semibold">{inr(plan.priceMinor)}<span className="text-helper ml-1 !text-[12px] font-normal">/ month</span></p>
        <p className="text-helper mb-3">+ {summary.gstRatePercent}% GST ({inr(gst)}), {inr(plan.priceWithGstMinor)} charged</p>
        <ul className="mb-4 space-y-1.5 text-[13px]">
          {LIMIT_KEYS.map((k) => <li key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{ENTITLEMENT_LABELS[k]}</span><span className="num font-medium">{limitText(plan.limits[k])}</span></li>)}
          {FEATURE_KEYS.map((k) => <li key={k} className="flex items-center gap-1.5">{plan.features[k] ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}<span className={plan.features[k] ? '' : 'text-muted-foreground line-through'}>{ENTITLEMENT_LABELS[k]}</span></li>)}
        </ul>
        {summary.canManage ? <Button className="mt-auto" variant={current && paid ? 'secondary' : 'primary'} disabled={(current && paid) || pending || busy} loading={busy} onClick={onChoose}>{label}</Button> : <p className="text-helper mt-auto">Ask an owner to change the plan.</p>}
      </CardBody>
    </Card>
  );
}

const SIM: { kind: string; label: string }[] = [
  { kind: 'activated', label: 'Payment authorised' }, { kind: 'charged', label: 'Payment succeeded (invoice)' }, { kind: 'payment_failed', label: 'Payment failed' },
  { kind: 'pending', label: 'Renewal failed (grace period)' }, { kind: 'cancelled', label: 'Cancelled' },
];

export default function BillingPage() {
  const qc = useQueryClient();
  const sum = useQuery({ queryKey: BILLING_KEY, queryFn: () => api<BillingSummary>('/billing/summary') });
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: () => api<PlanView[]>('/billing/plans') });
  const invoices = useQuery({ queryKey: ['billing-invoices'], queryFn: () => api<Invoice[]>('/billing/invoices'), enabled: sum.data?.canManage === true });
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ label: string; used: number; allowed: number }[]>([]);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: BILLING_KEY }); void qc.invalidateQueries({ queryKey: ['billing-invoices'] }); void qc.invalidateQueries({ queryKey: ['usage'] }); };
  const poll = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 2500)); refresh(); } };

  async function choose(planKey: string) {
    const s = sum.data; if (!s) return;
    setBusyPlan(planKey); setProblems([]); setInlineError(null);
    try {
      const paid = s.provider.hasPaymentMethod && (s.status === 'ACTIVE' || s.status === 'PAST_DUE');
      if (paid) {
        const r = await api<{ effective: 'now' | 'cycle_end' }>('/billing/change-plan', { method: 'POST', body: { planKey } });
        toast.success(r.effective === 'now' ? 'Plan upgraded' : 'Downgrade scheduled for the end of this billing cycle');
        refresh();
      } else {
        const c = await api<CheckoutInit>('/billing/subscribe', { method: 'POST', body: { planKey } });
        if (c.mode === 'live') {
          const Rz = await loadCheckout();
          new Rz({ key: c.keyId, subscription_id: c.subscriptionId, name: 'LeadPilot', description: `${c.planName} plan`, theme: { color: '#4f46e5' },
            handler: () => { toast.success('Payment received. Activating your plan…'); void poll(); } }).open();
        } else toast.message('Test-mode checkout started', { description: 'Use the test panel below to simulate the payment result.' });
        refresh();
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'billing_profile_required') { setPendingPlan(planKey); setProfileOpen(true); toast.message(e.message); }
      else if (e instanceof ApiError) { setProblems(problemList(e)); setInlineError(e.message); toast.error(e.message); }
      else toast.error('Something went wrong. Please try again.');
    } finally { setBusyPlan(null); }
  }

  const sim = useMutation({
    mutationFn: (kind: string) => api<{ status: string; reason?: string }>('/billing/mock/simulate', { method: 'POST', body: { kind } }),
    onSuccess: (r) => { toast.success(`Simulated: ${r.status}${r.reason ? ` (${r.reason})` : ''}`); refresh(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Simulation failed'),
  });

  if (sum.isPending || plans.isPending) return <><PageHeader title="Subscription & Billing" /><Skeleton className="h-64" /></>;
  if (sum.isError || plans.isError) return <><PageHeader title="Subscription & Billing" /><Card><CardBody>Could not load billing. <Button variant="link" onClick={() => { void sum.refetch(); void plans.refetch(); }}>Retry</Button></CardBody></Card></>;
  const s = sum.data;
  const dateLine = s.status === 'TRIALING' ? `Trial ends ${fmtDate(s.trialEndsAt)} (${Math.max(0, daysLeft(s.trialEndsAt))} days left)` : s.status === 'PAST_DUE' ? `Grace period ends ${fmtDate(s.graceEndsAt)}` : s.cancelAtPeriodEnd || s.status === 'CANCELED' ? `Ends ${fmtDate(s.currentPeriodEnd)}` : s.currentPeriodEnd ? `Renews ${fmtDate(s.currentPeriodEnd)}` : '';
  const canCancel = s.canManage && !s.cancelAtPeriodEnd && (s.status === 'ACTIVE' || s.status === 'TRIALING');

  return (
    <>
      <PageHeader title="Subscription & Billing" description="Plans, GST invoices and payment status." actions={s.canManage ? <Button onClick={() => { setPendingPlan(null); setProfileOpen(true); }}>Billing details</Button> : undefined} />
      <Card className="mb-4"><CardBody className="flex flex-wrap items-center gap-4">
        <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="text-heading">{s.planName}</span><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>{s.pendingPlanKey ? <Badge tone="neutral">Moving to {plans.data.find((p) => p.key === s.pendingPlanKey)?.name ?? s.pendingPlanKey} at renewal</Badge> : null}</div>
          <p className="text-helper mt-0.5 !text-[13px]">{s.status === 'INTERNAL' ? 'This workspace is on the unmetered internal plan. No billing applies.' : dateLine}{s.cancelAtPeriodEnd ? ' · Cancellation scheduled' : ''}{s.provider.lastPaymentFailedAt ? ` · Last payment failed ${fmtDate(s.provider.lastPaymentFailedAt)}` : ''}</p>
        </div>
        {canCancel ? <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel subscription</Button> : null}
      </CardBody></Card>

      {!s.canManage ? <Card className="mb-4"><CardBody className="text-[13px]">Only owners can change the plan or see invoices. Ask an owner of this workspace if you need billing changes. See <Link href="/usage" className="text-primary hover:underline">Usage</Link> for what your plan includes.</CardBody></Card> : null}
      {inlineError ? <div role="alert" className="mb-4 rounded-md border border-border bg-danger-soft px-3 py-2 text-[13px] text-danger">{inlineError}{problems.length ? <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p.label}>{p.label}: using {p.used.toLocaleString('en-IN')}, new plan allows {p.allowed.toLocaleString('en-IN')}</li>)}</ul> : null}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {plans.data.map((p) => <PlanCard key={p.key} plan={p} summary={s} plans={plans.data} busy={busyPlan === p.key} onChoose={() => void choose(p.key)} />)}
      </div>
      <p className="text-helper mb-4">Prices exclude GST. Upgrades apply immediately (the provider prorates the difference); downgrades start at the next renewal and need your usage to fit the new plan.</p>

      {s.provider.mode === 'mock' && s.canManage ? (
        <Card className="mb-4 border-dashed"><CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4" aria-hidden />Test mode: no real payment</CardTitle><Badge tone="warning">Mock provider</Badge></CardHeader><CardBody>
          <p className="text-helper mb-2">Start a subscription above, then push signed test events through the real webhook path. Not available in production.</p>
          <div className="flex flex-wrap gap-2">{SIM.map((x) => <Button key={x.kind} size="sm" loading={sim.isPending && sim.variables === x.kind} onClick={() => sim.mutate(x.kind)}>{x.label}</Button>)}</div>
        </CardBody></Card>
      ) : null}

      {s.canManage ? (
        <Card><CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
          {invoices.isPending ? <CardBody><Skeleton className="h-16" /></CardBody> : invoices.data?.length ? (
            <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-4 py-2 font-medium">Invoice</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Description</th><th className="px-4 py-2 text-right font-medium">Total (incl. GST)</th><th /></tr></thead><tbody>
              {invoices.data.map((i) => <tr key={i.id} className="border-b border-border last:border-0"><td className="num px-4 py-2 font-medium">{i.number}</td><td className="px-4 py-2">{fmtDate(i.issuedAt)}</td><td className="px-4 py-2 text-muted-foreground">{i.description}</td><td className="num px-4 py-2 text-right">{inr(i.totalMinor)}</td><td className="px-4 py-2 text-right"><Link href={`/invoice/${i.id}`} target="_blank" className="text-primary hover:underline">View</Link></td></tr>)}
            </tbody></table></div>
          ) : <CardBody className="text-helper">No invoices yet. A GST invoice is issued for every successful payment.</CardBody>}
        </Card>
      ) : null}

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} onSaved={() => { refresh(); if (pendingPlan) { const k = pendingPlan; setPendingPlan(null); void choose(k); } }} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel subscription?" description={`You keep full access until ${fmtDate(s.currentPeriodEnd ?? s.trialEndsAt)}. After that the workspace becomes read-only. Nothing is deleted.`} confirmLabel="Cancel subscription" danger
        onConfirm={async () => { try { await api('/billing/cancel', { method: 'POST', body: {} }); toast.success('Subscription cancelled'); refresh(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not cancel'); throw e; } }} />
    </>
  );
}
