import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from '@/components/skeletons';

export default function PlatformAuditLoading() {
  return (
    <PageSkeleton title="Platform Audit">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-40 flex-1" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-4 w-32 font-mono text-xs rounded" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-40 flex-1" />
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}
