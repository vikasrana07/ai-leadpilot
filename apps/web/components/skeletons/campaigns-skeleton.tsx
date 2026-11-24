import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function CampaignsSkeleton() {
  return (
    <PageSkeleton title="Campaigns">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4 rounded-full" />
            </CardHeader>
            <CardBody className="space-y-1">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-32" />
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border pb-2 overflow-x-auto">
        {['w-24', 'w-16', 'w-20', 'w-18', 'w-20', 'w-18'].map((w, i) => (
          <Skeleton key={i} className={`h-7 ${w} rounded-md`} />
        ))}
      </div>

      {/* Campaign Cards List */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-3.5 w-64" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>

            {/* Campaign Metrics Bar */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-border/50 pt-3">
              {Array.from({ length: 4 }).map((_, m) => (
                <div key={m} className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}

export function CampaignDetailSkeleton() {
  return (
    <PageSkeleton title="Campaign Details">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <Skeleton className="h-3.5 w-16" />
        <span className="text-muted-foreground/40">/</span>
        <Skeleton className="h-3.5 w-32" />
      </div>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-52 rounded" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* 4 Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3.5 space-y-1.5 shadow-xs">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>

      {/* Template Preview Card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardBody>
          <div className="max-w-md rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </CardBody>
      </Card>

      {/* Recipients Table */}
      <Card className="overflow-hidden">
        <CardHeader>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-48 rounded-md" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3.5 w-24 hidden sm:block" />
              <Skeleton className="h-3.5 w-20 hidden md:block" />
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}
