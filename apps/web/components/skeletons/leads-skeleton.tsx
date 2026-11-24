import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function LeadsTableRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {/* Checkbox */}
          <Skeleton className="h-4 w-4 shrink-0 rounded" />

          {/* Lead Name + Contact Info */}
          <div className="flex min-w-44 flex-1 items-center gap-2.5">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>

          {/* Stage Badge */}
          <div className="w-24 shrink-0 hidden sm:block">
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>

          {/* Temperature Badge */}
          <div className="w-16 shrink-0 hidden md:block">
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>

          {/* Budget / Value */}
          <div className="w-24 shrink-0 hidden lg:block">
            <Skeleton className="h-4 w-18" />
          </div>

          {/* Assigned Teammate */}
          <div className="w-28 shrink-0 hidden lg:flex items-center gap-1.5">
            <Skeleton className="h-5 w-5 rounded-full shrink-0" />
            <Skeleton className="h-3.5 w-16" />
          </div>

          {/* AI Score */}
          <div className="w-14 shrink-0 hidden md:block">
            <Skeleton className="h-5 w-10 rounded" />
          </div>

          {/* Next Follow-up */}
          <div className="w-24 shrink-0 hidden xl:block">
            <Skeleton className="h-3.5 w-20" />
          </div>

          {/* Added Time */}
          <div className="w-16 shrink-0 hidden sm:block">
            <Skeleton className="h-3.5 w-12" />
          </div>

          {/* Action Menu */}
          <div className="w-8 shrink-0 flex justify-end">
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LeadsSkeleton() {
  return (
    <PageSkeleton title="Leads">
      {/* Header with Export, Import, Add Lead buttons */}
      <PageHeaderSkeleton hasDescription={true} actionCount={2} />

      {/* QuickViews Pills Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-hidden="true">
        {['All Leads', 'Hot Leads', 'Needs Follow-up', 'Unassigned', 'Won', 'Lost'].map(
          (label, i) => (
            <Skeleton
              key={i}
              className={`h-7 rounded-full ${i === 0 ? 'w-20' : i === 2 ? 'w-32' : 'w-24'}`}
            />
          )
        )}
      </div>

      {/* Data Table Container */}
      <Card className="overflow-hidden">
        {/* DataTableToolbar Skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border bg-card p-3">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-64">
            <Skeleton className="h-9 w-64 max-w-full rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
        </div>

        {/* Table Header Row */}
        <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-3.5 w-24 flex-1" />
          <Skeleton className="h-3.5 w-16 hidden sm:block" />
          <Skeleton className="h-3.5 w-12 hidden md:block" />
          <Skeleton className="h-3.5 w-16 hidden lg:block" />
          <Skeleton className="h-3.5 w-16 hidden lg:block" />
          <Skeleton className="h-3.5 w-10 hidden md:block" />
          <Skeleton className="h-3.5 w-16 hidden xl:block" />
          <Skeleton className="h-3.5 w-12 hidden sm:block" />
          <Skeleton className="h-3.5 w-6" />
        </div>

        {/* Table Rows */}
        <LeadsTableRowsSkeleton count={8} />

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <Skeleton className="h-4 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </Card>
    </PageSkeleton>
  );
}
