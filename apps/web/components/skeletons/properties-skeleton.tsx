import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function PropertiesTableRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {/* Thumbnail & Title */}
          <div className="flex min-w-44 flex-1 items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-md shrink-0" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>

          {/* Type */}
          <div className="w-24 shrink-0 hidden sm:block">
            <Skeleton className="h-5 w-18 rounded" />
          </div>

          {/* Status */}
          <div className="w-24 shrink-0 hidden sm:block">
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>

          {/* Price */}
          <div className="w-28 shrink-0 hidden md:block">
            <Skeleton className="h-4 w-20" />
          </div>

          {/* Units / Beds */}
          <div className="w-20 shrink-0 hidden lg:block">
            <Skeleton className="h-4 w-14" />
          </div>

          {/* Added */}
          <div className="w-20 shrink-0 hidden xl:block">
            <Skeleton className="h-3.5 w-16" />
          </div>

          {/* Actions */}
          <div className="w-8 shrink-0 flex justify-end">
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PropertiesSkeleton() {
  return (
    <PageSkeleton title="Properties">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* Filter / Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5">
        <Skeleton className="h-9 min-w-48 flex-1 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* Table Container */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
          <Skeleton className="h-3.5 w-28 flex-1" />
          <Skeleton className="h-3.5 w-16 hidden sm:block" />
          <Skeleton className="h-3.5 w-16 hidden sm:block" />
          <Skeleton className="h-3.5 w-20 hidden md:block" />
          <Skeleton className="h-3.5 w-14 hidden lg:block" />
          <Skeleton className="h-3.5 w-14 hidden xl:block" />
          <Skeleton className="h-3.5 w-6" />
        </div>

        <PropertiesTableRowsSkeleton count={6} />
      </Card>
    </PageSkeleton>
  );
}
