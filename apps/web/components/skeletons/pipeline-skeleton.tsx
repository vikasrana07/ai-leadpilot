import { Skeleton } from '@/components/ui/skeleton';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function PipelineColumnsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      {Array.from({ length: count }).map((_, col) => (
        <section
          key={col}
          className="flex h-[calc(100dvh-14rem)] w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/40"
        >
          {/* Column Header */}
          <header className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-4 w-6 rounded-full" />
          </header>

          {/* Column Cards */}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {Array.from({ length: col === 0 ? 4 : col === 1 ? 3 : col === 2 ? 2 : 1 }).map(
              (_, card) => (
                <div
                  key={card}
                  className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-5 rounded shrink-0" />
                  </div>
                  <Skeleton className="h-3 w-24" />
                  <div className="flex items-center justify-between pt-1 border-t border-border/30">
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-5 w-5 rounded-full" />
                      <Skeleton className="h-4 w-12 rounded" />
                    </div>
                    <Skeleton className="h-4 w-8 rounded" />
                  </div>
                </div>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export function PipelineSkeleton() {
  return (
    <PageSkeleton title="Sales Pipeline">
      {/* Header with Assigned, Temperature filter dropdowns and Configure button */}
      <PageHeaderSkeleton hasDescription={true} actionCount={3} />

      {/* Notice bar placeholder */}
      <div className="mb-3 h-8" />

      {/* Board Columns */}
      <PipelineColumnsSkeleton count={4} />
    </PageSkeleton>
  );
}
