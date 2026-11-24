import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function AutomationCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4.5 w-48" />
                <Skeleton className="h-5 w-12 rounded-full" />
                {i === 1 && <Skeleton className="h-5 w-28 rounded-full" />}
              </div>
              <Skeleton className="h-3.5 w-64" />
              <Skeleton className="h-3.5 w-80 max-w-full" />
              <Skeleton className="h-3 w-56 pt-0.5" />
            </div>

            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function AutomationsSkeleton() {
  return (
    <PageSkeleton title="Automations">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* Tabs Bar */}
      <div className="mb-3 flex gap-4 border-b border-border pb-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>

      <AutomationCardsSkeleton count={4} />
    </PageSkeleton>
  );
}

export function AutomationBuilderSkeleton() {
  return (
    <PageSkeleton title="Automation Builder" className="space-y-0 h-[calc(100vh-5rem)] flex flex-col">
      {/* Builder Top Bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="space-y-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-12 rounded-full" />
        </div>
      </div>

      {/* Canvas Area with Inspector Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas Graph with visual nodes and connector wireframes */}
        <div className="flex-1 bg-muted/20 relative flex flex-col items-center justify-center p-8 overflow-auto">
          {/* Node 1: Trigger */}
          <div className="w-72 rounded-lg border border-border bg-card p-3.5 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-40" />
          </div>

          {/* Connection Line */}
          <div className="w-0.5 h-10 bg-border/80 my-1" />

          {/* Node 2: Condition / Filter */}
          <div className="w-72 rounded-lg border border-border bg-card p-3.5 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <Skeleton className="h-3 w-36" />
          </div>

          {/* Connection Line */}
          <div className="w-0.5 h-10 bg-border/80 my-1" />

          {/* Node 3: Action */}
          <div className="w-72 rounded-lg border border-border bg-card p-3.5 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <Skeleton className="h-3 w-44" />
          </div>
        </div>

        {/* Right Inspector Panel */}
        <aside className="w-80 shrink-0 border-l border-border bg-surface p-4 space-y-4 hidden md:block">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-5 rounded" />
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        </aside>
      </div>
    </PageSkeleton>
  );
}
