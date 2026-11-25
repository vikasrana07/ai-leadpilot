'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Building2,
  Clock,
  CreditCard,
  IndianRupee,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlatformOverviewSkeleton } from '@/components/skeletons';
import { PlatformKpiCard } from '@/components/platform/platform-kpi-card';
import { inr } from '@/lib/billing';
import { platformApi, type PlatformMetrics } from '@/lib/platform';

export default function PlatformOverview() {
  const q = useQuery({
    queryKey: ['platform-metrics'],
    queryFn: () => platformApi<PlatformMetrics>('/metrics'),
  });

  if (q.isPending) return <PlatformOverviewSkeleton />;
  if (q.isError) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">Could not load platform metrics.</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void q.refetch()}
          >
            Try Again
          </Button>
        </Card>
      </>
    );
  }

  const m = q.data;
  const n = (v: number) => v.toLocaleString('en-IN');
  const totalSubs =
    (m.subscriptions.active || 0) +
    (m.subscriptions.trialing || 0) +
    (m.subscriptions.pastDue || 0) +
    (m.subscriptions.endedOrExpired || 0);

  const subItems = [
    {
      label: 'Active',
      value: m.subscriptions.active,
      color: 'bg-emerald-500',
      textColor: 'text-emerald-600 dark:text-emerald-400',
      tone: 'success' as const,
    },
    {
      label: 'On Trial',
      value: m.subscriptions.trialing,
      color: 'bg-primary',
      textColor: 'text-primary',
      tone: 'primary' as const,
    },
    {
      label: 'Past Due (Grace)',
      value: m.subscriptions.pastDue,
      color: 'bg-amber-500',
      textColor: 'text-amber-600 dark:text-amber-400',
      tone: 'warning' as const,
    },
    {
      label: 'Cancelled / Expired',
      value: m.subscriptions.endedOrExpired,
      color: 'bg-slate-400',
      textColor: 'text-muted-foreground',
      tone: 'neutral' as const,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Overview"
        description="Whole-platform metrics, workspace health, and active revenue streams."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/platform/tenants">
                <Building2 className="h-4 w-4 mr-1.5" />
                Manage Tenants
              </Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/platform/plans">
                <CreditCard className="h-4 w-4 mr-1.5" />
                Configure Plans
              </Link>
            </Button>
          </div>
        }
      />

      {/* 4 Hero KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PlatformKpiCard
          label="MRR (Ex-GST)"
          value={inr(m.mrrMinor)}
          icon={IndianRupee}
          hint="Recurring monthly subscriptions; complimentary accounts excluded"
        />

        <PlatformKpiCard
          label="Total Workspaces"
          value={n(m.tenants.total)}
          icon={Building2}
          trend={{
            value: `+${n(m.tenants.new30d)} in 30d`,
            positive: true,
          }}
          hint={`${n(m.tenants.suspended)} suspended ${m.tenants.suspended === 1 ? 'workspace' : 'workspaces'}`}
        />

        <PlatformKpiCard
          label="Paying Subscriptions"
          value={n(m.subscriptions.active)}
          icon={CreditCard}
          trend={{
            value: `${n(m.subscriptions.trialing)} trialing`,
            positive: false,
          }}
          hint={`${n(m.subscriptions.complimentary)} complimentary grants`}
        />

        <PlatformKpiCard
          label="AI Tokens This Month"
          value={n(m.aiTokensThisMonth)}
          icon={Sparkles}
          hint="Model inference & embeddings consumption across all tenants"
        />
      </div>

      {/* Breakdown Grids */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subscription Breakdown Card */}
        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Subscription Health</CardTitle>
              <p className="text-helper mt-0.5">
                Lifecycle states across {n(totalSubs)} tracked customer subscriptions
              </p>
            </div>
            <Badge tone="primary">
              {totalSubs > 0 ? Math.round((m.subscriptions.active / totalSubs) * 100) : 0}% Active
            </Badge>
          </CardHeader>
          <CardBody className="flex-1 space-y-4">
            {/* Visual segmented distribution bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {subItems.map((item) => {
                const pct = totalSubs > 0 ? (item.value / totalSubs) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={item.label}
                    className={item.color}
                    style={{ width: `${pct}%` }}
                    title={`${item.label}: ${n(item.value)} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>

            {/* List breakdown with visual dots */}
            <div className="divide-y divide-border">
              {subItems.map((item) => {
                const pct = totalSubs > 0 ? ((item.value / totalSubs) * 100).toFixed(1) : '0';
                return (
                  <div
                    key={item.label}
                    className="flex items-center justify-between py-2.5 text-[13px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                      <span className="font-medium text-foreground">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num font-semibold text-foreground">
                        {n(item.value)}
                      </span>
                      <span className="num text-[12px] text-muted-foreground w-12 text-right">
                        {pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Workspaces by Plan Breakdown */}
        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Workspaces by Plan</CardTitle>
              <p className="text-helper mt-0.5">
                Tier distribution for {n(m.tenants.total)} total registered workspaces
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/platform/plans" className="text-[12px] text-primary">
                View Plans
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardBody className="flex-1 space-y-3.5">
            {Object.entries(m.tenants.byPlan).length === 0 ? (
              <p className="py-8 text-center text-helper">No plans assigned yet.</p>
            ) : (
              Object.entries(m.tenants.byPlan).map(([planKey, count]) => {
                const total = m.tenants.total || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={planKey} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[13px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize text-foreground">
                          {planKey}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.2 text-[11px] font-mono text-muted-foreground">
                          {planKey}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="num font-semibold text-foreground">{n(count)}</span>
                        <span className="num text-[12px] text-muted-foreground">({pct}%)</span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>

      {/* Operational Fast Links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/platform/tenants"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary group-hover:scale-105 transition-transform">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">
                Tenant Workspaces
              </p>
              <p className="text-[12px] text-muted-foreground">
                Manage accounts, quotas & overrides
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </Link>

        <Link
          href="/platform/ops"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-soft text-success group-hover:scale-105 transition-transform">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">
                System Operations
              </p>
              <p className="text-[12px] text-muted-foreground">
                Queues, background workers & SLOs
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </Link>

        <Link
          href="/platform/audit"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground group-hover:scale-105 transition-transform">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">
                Security Audit Log
              </p>
              <p className="text-[12px] text-muted-foreground">
                Tamper-evident administrative history
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </Link>
      </div>
    </div>
  );
}
