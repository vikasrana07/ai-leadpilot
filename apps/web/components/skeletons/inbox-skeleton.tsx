import { Skeleton } from '@/components/ui/skeleton';

export function InboxThreadSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col justify-between bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </header>

      {/* Bubble Messages Stream */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {/* Inbound message */}
        <div className="flex gap-2 max-w-[80%] sm:max-w-[70%]">
          <Skeleton className="h-6 w-6 rounded-full shrink-0" />
          <div className="space-y-1.5 rounded-2xl rounded-tl-xs border border-border bg-card p-3.5 shadow-2xs">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-12 pt-1" />
          </div>
        </div>

        {/* Outbound AI message */}
        <div className="flex justify-end">
          <div className="space-y-1.5 rounded-2xl rounded-tr-xs bg-muted/60 p-3.5 max-w-[80%] sm:max-w-[70%] shadow-2xs">
            <div className="flex items-center gap-1.5 pb-1">
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3.5 w-64" />
            <Skeleton className="h-3.5 w-52" />
            <div className="flex justify-end">
              <Skeleton className="h-2.5 w-14" />
            </div>
          </div>
        </div>

        {/* Inbound message */}
        <div className="flex gap-2 max-w-[80%] sm:max-w-[70%]">
          <Skeleton className="h-6 w-6 rounded-full shrink-0" />
          <div className="space-y-1.5 rounded-2xl rounded-tl-xs border border-border bg-card p-3.5 shadow-2xs">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-12 pt-1" />
          </div>
        </div>

        {/* Outbound Agent message */}
        <div className="flex justify-end">
          <div className="space-y-1.5 rounded-2xl rounded-tr-xs bg-muted/60 p-3.5 max-w-[80%] sm:max-w-[70%] shadow-2xs">
            <Skeleton className="h-3.5 w-56" />
            <div className="flex justify-end">
              <Skeleton className="h-2.5 w-14" />
            </div>
          </div>
        </div>
      </div>

      {/* Composer Input Bar */}
      <div className="border-t border-border bg-surface p-3">
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading inbox"
      className="flex h-[calc(100vh-4rem)] w-full min-h-0 flex-1 overflow-hidden"
    >
      <span className="sr-only">Loading inbox...</span>

      {/* 1. Leftmost Queues Sidebar (xl screens) */}
      <nav className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border bg-header p-3 xl:flex">
        <Skeleton className="h-6 w-20 mb-3 ml-2" />
        {/* Queues list */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-md px-2.5 py-2">
            <Skeleton className="h-4 w-24" />
            {i === 3 && <Skeleton className="h-4 w-6 rounded-full" />}
          </div>
        ))}
        {/* Channel section */}
        <Skeleton className="h-3 w-16 mt-4 mb-2 ml-2" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full rounded-md mb-1" />
        ))}
      </nav>

      {/* 2. Middle Conversations List */}
      <section className="flex w-full shrink-0 flex-col border-r border-border bg-surface md:w-80">
        <div className="space-y-2 border-b border-border p-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="flex gap-1.5 overflow-x-auto xl:hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-full shrink-0" />
            ))}
          </div>
        </div>

        {/* Conversation list items */}
        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-3 py-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <Skeleton className="h-4 w-10 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Right Thread Area */}
      <div className="hidden min-w-0 flex-1 md:flex">
        <InboxThreadSkeleton />
      </div>

      {/* 4. Customer Details Panel (xl screens) */}
      <aside className="hidden w-72 shrink-0 border-l border-border bg-surface p-4 space-y-4 xl:block">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="space-y-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <div className="flex flex-wrap gap-1">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </aside>
    </div>
  );
}
