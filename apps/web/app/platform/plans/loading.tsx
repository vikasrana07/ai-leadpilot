import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from '@/components/skeletons';

export default function PlatformPlansLoading() {
  return (
    <PageSkeleton title="Plans">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4 space-y-3">
            <CardHeader className="flex justify-between items-center p-0 pb-2 border-b border-border/50">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </CardHeader>
            <CardBody className="p-0 space-y-2">
              <Skeleton className="h-6 w-24" />
              <div className="space-y-1 pt-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}
