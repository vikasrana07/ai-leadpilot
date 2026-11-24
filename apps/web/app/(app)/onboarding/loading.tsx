import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from '@/components/skeletons';

export default function OnboardingLoading() {
  return (
    <PageSkeleton title="Setup your workspace">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Left Step list */}
        <div className="space-y-1.5" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2.5">
              <Skeleton className="h-5 w-5 rounded-full shrink-0" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>

        {/* Right Active Step Card */}
        <Card>
          <div className="h-1 bg-muted skeleton" />
          <CardBody className="p-6 space-y-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3.5 w-80 max-w-full mb-6" />

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="flex justify-end pt-4">
                <Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </PageSkeleton>
  );
}
