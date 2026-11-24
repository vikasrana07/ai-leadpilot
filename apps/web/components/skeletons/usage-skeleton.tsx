import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function UsageSkeleton() {
  return (
    <PageSkeleton title="Usage">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      {/* Plan & Limits Card */}
      <Card className="mb-3">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardBody>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* 2x2 Metric Breakdown Grid */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* AI Assistant */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="divide-y divide-border pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between py-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Messages */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardBody>
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between py-2">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3.5 w-14" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Work */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-20" />
          </CardHeader>
          <CardBody>
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between py-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-12" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Workspace */}
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardBody>
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between py-2">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </PageSkeleton>
  );
}
