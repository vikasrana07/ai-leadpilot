import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function RolesSkeleton() {
  return (
    <PageSkeleton title="Roles & Permissions">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex flex-col justify-between p-5 space-y-4">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3.5 w-48" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full shrink-0" />
              </div>

              {/* Member count pill */}
              <Skeleton className="h-4 w-24" />

              {/* Permissions Checklist Mock */}
              <div className="space-y-2 border-t border-border/50 pt-3">
                <Skeleton className="h-3 w-28 font-medium" />
                {Array.from({ length: 3 }).map((_, p) => (
                  <div key={p} className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-3.5 rounded" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                ))}
              </div>
            </div>

            {/* Action buttons footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}
