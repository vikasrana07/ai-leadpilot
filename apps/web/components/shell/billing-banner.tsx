'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { daysLeft, fmtDate, type BillingSummary } from '@/lib/billing';
import { cn } from '@/lib/cn';

export const BILLING_KEY = ['billing-summary'] as const;

/** Trial, failed-payment, read-only and cancellation notices. Shown to everyone; only owners/billing managers get the link. */
export function BillingBanner() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: BILLING_KEY, queryFn: () => api<BillingSummary>('/billing/summary'), staleTime: 60_000 });
  useEffect(() => {
    const h = () => void qc.invalidateQueries({ queryKey: BILLING_KEY });
    window.addEventListener('lp:billing', h);
    return () => window.removeEventListener('lp:billing', h);
  }, [qc]);
  const s = q.data;
  if (!s || s.status === 'INTERNAL') return null;

  let tone: 'info' | 'warning' | 'danger' | null = null; let text = '';
  if (s.restricted) { tone = 'danger'; text = s.trialEndsAt && !s.currentPeriodEnd ? 'Your free trial has ended. Your workspace is read-only: you can view and export, but changes are paused.' : 'Your subscription is not active. Your workspace is read-only until a plan is active. Nothing has been deleted.'; }
  else if (s.status === 'PAST_DUE') { tone = 'warning'; text = `Your last payment failed. Update your payment method before ${fmtDate(s.graceEndsAt)} to avoid going read-only.`; }
  else if (s.status === 'TRIALING' && daysLeft(s.trialEndsAt) <= 7) { tone = 'info'; text = `Your free trial ends in ${Math.max(0, daysLeft(s.trialEndsAt))} day${daysLeft(s.trialEndsAt) === 1 ? '' : 's'} (${fmtDate(s.trialEndsAt)}). Choose a plan to avoid interruption.`; }
  else if (s.cancelAtPeriodEnd || s.status === 'CANCELED') { tone = 'info'; text = `Your subscription is cancelled and ends on ${fmtDate(s.currentPeriodEnd)}.`; }
  if (!tone) return null;
  const Icon = tone === 'danger' ? Lock : tone === 'warning' ? AlertTriangle : Info;
  return (
    <div role="status" className={cn('flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-[13px] sm:px-8', tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-accent-foreground')}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{text}</span>
      {s.canManage ? <Link href="/billing" className="font-medium underline">Manage billing</Link> : <span>Ask an owner to update billing.</span>}
    </div>
  );
}
