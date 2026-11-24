import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function SecuritySkeleton() {
  return (
    <PageSkeleton title="Security">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      <div className="max-w-2xl space-y-4">
        {/* Two-Step Verification Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-44" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <div className="pt-2">
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </CardBody>
        </Card>

        {/* Workspace Policy Card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-full" />
            <div className="pt-2">
              <Skeleton className="h-9 w-40 rounded-md" />
            </div>
          </CardBody>
        </Card>
      </div>
    </PageSkeleton>
  );
}
