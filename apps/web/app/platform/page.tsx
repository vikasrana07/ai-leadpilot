'use client';

import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/page/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformOverviewSkeleton } from '@/components/skeletons';
import { inr } from '@/lib/billing';
import { platformApi, type PlatformMetrics } from '@/lib/platform';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Card><CardBody><p className="text-helper">{label}</p><p className="num mt-1 text-[24px] font-semibold">{value}</p>{hint ? <p className="text-helper mt-0.5">{hint}</p> : null}</CardBody></Card>;
}

export default function PlatformOverview() {
  const q = useQuery({ queryKey: ['platform-metrics'], queryFn: () => platformApi<PlatformMetrics>('/metrics') });
  if (q.isPending) return <PlatformOverviewSkeleton />;
  if (q.isError) return <><PageHeader title="Overview" /><p className="text-helper">Could not load metrics.</p></>;
  const m = q.data; const n = (v: number) => v.toLocaleString('en-IN');
  return (
    <>
      <PageHeader title="Overview" description="Whole-platform numbers. Revenue excludes GST." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="MRR (ex-GST)" value={inr(m.mrrMinor)} hint="Paying subscriptions only; complimentary plans excluded" />
        <Stat label="Workspaces" value={n(m.tenants.total)} hint={`${n(m.tenants.new30d)} new in 30 days · ${n(m.tenants.suspended)} suspended`} />
        <Stat label="Paying subscriptions" value={n(m.subscriptions.active)} hint={`${n(m.subscriptions.complimentary)} complimentary`} />
        <Stat label="AI tokens this month" value={n(m.aiTokensThisMonth)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Subscriptions</CardTitle></CardHeader><CardBody className="divide-y divide-border text-[13px]">
          {[['On trial', m.subscriptions.trialing], ['Active', m.subscriptions.active], ['Payment failed (grace)', m.subscriptions.pastDue], ['Cancelled / expired', m.subscriptions.endedOrExpired]].map(([l, v]) => <div key={l as string} className="flex justify-between py-2"><span className="text-muted-foreground">{l}</span><span className="num font-medium">{n(v as number)}</span></div>)}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Workspaces by plan</CardTitle></CardHeader><CardBody className="divide-y divide-border text-[13px]">
          {Object.entries(m.tenants.byPlan).map(([k, v]) => <div key={k} className="flex justify-between py-2"><span className="text-muted-foreground">{k}</span><span className="num font-medium">{n(v)}</span></div>)}
        </CardBody></Card>
      </div>
    </>
  );
}
