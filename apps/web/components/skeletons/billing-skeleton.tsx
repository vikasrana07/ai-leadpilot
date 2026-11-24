import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function BillingPlansGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="flex flex-col justify-between p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              {i === 1 && <Skeleton className="h-5 w-16 rounded-full" />}
            </div>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3.5 w-full" />

            {/* Features List */}
            <div className="space-y-2 border-t border-border/50 pt-3">
              {Array.from({ length: 5 }).map((_, f) => (
                <div key={f} className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          </div>

          <Skeleton className="h-9 w-full rounded-md" />
        </Card>
      ))}
    </div>
  );
}

export function BillingSkeleton() {
  return (
    <PageSkeleton title="Subscription & Billing">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      {/* Current Subscription Banner */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
      </Card>

      {/* Plan Selection Cards */}
      <BillingPlansGridSkeleton />

      {/* Invoices Card */}
      <Card className="overflow-hidden">
        <CardHeader>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3.5 w-24 hidden sm:block" />
              </div>
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}
