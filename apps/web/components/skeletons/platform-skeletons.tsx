import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function PlatformOverviewSkeleton() {
  return (
    <PageSkeleton title="Platform Overview">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      {/* 4 Platform Stat Cards */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="space-y-1.5 p-4">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-40" />
            </CardBody>
          </Card>
        ))}
      </div>

      {/* 2 Breakdown Cards */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardBody className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between py-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-12" />
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardBody className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between py-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-12" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </PageSkeleton>
  );
}

export function PlatformTenantsSkeleton() {
  return (
    <PageSkeleton title="Workspaces">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      {/* Filter Bar */}
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64 max-w-full rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Tenants Table */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
          <Skeleton className="h-3.5 w-36 flex-1" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-12 text-right" />
              <Skeleton className="h-4 w-14 text-right" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}

export function PlatformTenantDetailSkeleton() {
  return (
    <PageSkeleton title="Workspace Details">
      <PageHeaderSkeleton hasDescription={true} actionCount={2} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardBody className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between py-1">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardBody className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </PageSkeleton>
  );
}

export function PlatformOpsSkeleton() {
  return (
    <PageSkeleton title="Ops status">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4.5 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="space-y-2 border-t border-border/50 pt-2">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}
