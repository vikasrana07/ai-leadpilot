import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageSkeleton } from './skeleton-primitives';

export function LeadDetailSkeleton() {
  return (
    <PageSkeleton title="Lead Details">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <Skeleton className="h-3.5 w-12" />
        <span className="text-muted-foreground/40">/</span>
        <Skeleton className="h-3.5 w-28" />
      </div>

      {/* Header Profile Summary */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3.5">
          <Skeleton className="h-12 w-12 rounded-full shrink-0" />
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-7 w-48 rounded" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-36" />
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      </div>

      {/* Main 2-Column Split: 1fr on left, 360px on right */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Properties / Details Card */}
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3.5 w-16" />
            </CardHeader>
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Activity & Notes Card */}
          <Card>
            {/* Tabs Header */}
            <div className="flex items-center gap-4 border-b border-border px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
            <CardBody className="space-y-4">
              {/* Note input wireframe */}
              <Skeleton className="h-18 w-full rounded-md" />
              <div className="flex justify-end">
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>

              {/* Timeline Items */}
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="relative space-y-1.5">
                    <div className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-background bg-muted skeleton" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3.5 w-36" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-3 w-56" />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right Sidebar Column */}
        <div className="space-y-4">
          {/* AI Score Card */}
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-14 rounded-lg" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              </div>
              <div className="space-y-1.5 border-t border-border/50 pt-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </CardBody>
          </Card>

          {/* Pipeline & Assignment Card */}
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardBody className="space-y-3.5">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="h-8 flex-1 rounded-md" />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Tags Card */}
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-16" />
            </CardHeader>
            <CardBody className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-8 w-full rounded-md" />
            </CardBody>
          </Card>
        </div>
      </div>
    </PageSkeleton>
  );
}
