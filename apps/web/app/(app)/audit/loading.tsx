import { Skeleton } from '@/components/ui/skeleton';

export default function AuditLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading audit logs">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-1 h-4 w-60" />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5">
        <Skeleton className="h-9 w-48" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className="border-b border-border bg-muted/40 p-3">
          <Skeleton className="h-5 w-full" />
        </div>
        <div className="divide-y divide-border p-2 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 p-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-28 rounded" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
