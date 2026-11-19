import { Skeleton } from '@/components/ui/skeleton';

export default function PipelineLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading sales pipeline">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div>
          <Skeleton className="h-7 w-36" />
          <Skeleton className="mt-1 h-4 w-60" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Kanban Board Columns Skeleton */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex max-h-[calc(100dvh-14rem)] w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/40 p-2 space-y-2.5"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                  <div className="flex items-center justify-between pt-1">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-4 w-12 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
