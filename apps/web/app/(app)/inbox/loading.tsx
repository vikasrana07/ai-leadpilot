import { Skeleton } from '@/components/ui/skeleton';

export default function InboxLoading() {
  return (
    <div className="flex h-full w-full min-h-0 flex-1 divide-x divide-border" aria-busy="true" aria-label="Loading inbox">
      {/* Folder sidebar skeleton */}
      <div className="hidden w-48 shrink-0 p-3 space-y-2 lg:block">
        <Skeleton className="h-4 w-20 mb-3" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
      </div>

      {/* Conversations list skeleton */}
      <div className="w-full shrink-0 p-3 space-y-2.5 sm:w-80">
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="space-y-2 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-3 w-44" />
            </div>
          ))}
        </div>
      </div>

      {/* Message conversation thread skeleton */}
      <div className="hidden flex-1 flex-col p-4 justify-between sm:flex">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="space-y-3 py-6">
          <Skeleton className="h-10 w-64 rounded-2xl" />
          <Skeleton className="ml-auto h-12 w-72 rounded-2xl" />
          <Skeleton className="h-10 w-56 rounded-2xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    </div>
  );
}
