import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function SettingsSkeleton() {
  return (
    <PageSkeleton title="Settings">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      <div className="space-y-4 max-w-4xl">
        {/* Business Profile Card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </CardBody>
        </Card>

        {/* Lead Assignment Card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="max-w-md space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <Skeleton className="h-3 w-72" />
          </CardBody>
        </Card>

        {/* Active Sessions Card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <div className="divide-y divide-border">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="h-5 w-5 rounded shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageSkeleton>
  );
}
