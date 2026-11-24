import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function TasksListRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          {/* Circular Checkbox */}
          <Skeleton className="h-4.5 w-4.5 rounded-full shrink-0" />

          {/* Task Info */}
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-4 w-48 max-w-[80%]" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-28" />
              <span className="text-muted-foreground/30 text-xs">·</span>
              <Skeleton className="h-3 w-20" />
            </div>
          </div>

          {/* Due Date Badge */}
          <div className="hidden sm:block">
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>

          {/* Assignee Avatar */}
          <div className="hidden md:block">
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>

          {/* Action Menu */}
          <Skeleton className="h-7 w-7 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function TasksSkeleton() {
  return (
    <PageSkeleton title="Tasks">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      <Card className="overflow-hidden">
        {/* Filter and Control Bar */}
        <div className="border-b border-border bg-card p-3 space-y-3">
          {/* Top Row: Tabs + Scope */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
              {['w-16', 'w-16', 'w-20', 'w-16', 'w-14'].map((w, i) => (
                <Skeleton key={i} className={`h-6 ${w} rounded-md`} />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-8 w-36 rounded-md" />
            </div>
          </div>

          {/* Bottom Row: Search + Sort */}
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 min-w-56 flex-1 rounded-md" />
            <Skeleton className="h-9 w-40 rounded-md" />
          </div>
        </div>

        {/* Tasks List */}
        <TasksListRowsSkeleton count={6} />
      </Card>
    </PageSkeleton>
  );
}
