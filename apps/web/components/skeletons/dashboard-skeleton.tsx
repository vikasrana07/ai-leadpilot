import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton, KpiCardSkeleton } from './skeleton-primitives';

export function DashboardContentSkeleton() {
  return (
    <div className="space-y-4">
      {/* 6 KPI Cards matching dashboard grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCardSkeleton hasTrend={false} />
        <KpiCardSkeleton hasTrend={true} />
        <KpiCardSkeleton hasTrend={false} />
        <KpiCardSkeleton hasTrend={false} />
        <KpiCardSkeleton hasTrend={false} />
        <KpiCardSkeleton hasTrend={false} />
      </div>

      <Skeleton className="h-4 w-96 max-w-full" />

      {/* Analytics Charts Grid: Area Chart (1.4fr) + Pipeline Bar Chart (1fr) */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* Area Chart Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-3.5 w-24" />
          </CardHeader>
          <CardBody className="h-64 flex flex-col justify-between p-4">
            <div className="flex justify-between items-center gap-2 border-b border-border/40 pb-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex-1 flex items-end gap-2 pt-4 pb-2">
              {[40, 65, 30, 85, 45, 95, 60, 75, 50, 90, 70, 80].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <div
                    className="w-full rounded-t bg-muted/60 skeleton"
                    style={{ height: `${h}%` }}
                  />
                  <Skeleton className="h-2.5 w-full max-w-[28px]" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Pipeline Horizontal Bar Chart */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-20" />
          </CardHeader>
          <CardBody className="h-64 flex flex-col justify-around p-4 space-y-2">
            {[
              { label: 'New Lead', width: '85%' },
              { label: 'Contacted', width: '65%' },
              { label: 'Qualified', width: '50%' },
              { label: 'Proposal', width: '35%' },
              { label: 'Won', width: '20%' },
            ].map((bar, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <div className="h-5 w-full rounded bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded skeleton bg-primary/20"
                    style={{ width: bar.width }}
                  />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* 3-Column Highlights Row */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* Hot Leads */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          </CardHeader>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-44" />
                </div>
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
            ))}
          </div>
        </Card>

        {/* Upcoming Follow-ups */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </Card>

        {/* Lead Sources */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <div className="p-3 space-y-2">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-12" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between py-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-8" />
                <Skeleton className="h-3.5 w-8" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 2-Column Bottom Row: Recent Leads & Agents */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-14" />
          </CardHeader>
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <div className="p-3 space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <PageSkeleton title="Dashboard">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* Date Range Filter Pills */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {['w-16', 'w-20', 'w-18', 'w-18', 'w-24', 'w-18'].map((w, i) => (
          <Skeleton key={i} className={`h-8 ${w} rounded-full`} />
        ))}
      </div>

      <DashboardContentSkeleton />
    </PageSkeleton>
  );
}
