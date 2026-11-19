import { Skeleton } from '@/components/ui/skeleton';

export default function AppointmentsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading appointments">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div>
          <Skeleton className="h-7 w-36" />
          <Skeleton className="mt-1 h-4 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* View Switcher & Filter Card */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-3">
          <div className="flex gap-1">
            <Skeleton className="h-8 w-18" />
            <Skeleton className="h-8 w-18" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>

        {/* Calendar / List View Skeleton */}
        <div className="grid min-w-[700px] grid-cols-7 divide-x divide-border p-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="min-h-64 p-2 space-y-2">
              <Skeleton className="h-4 w-16 mb-3" />
              <div className="space-y-1.5">
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
