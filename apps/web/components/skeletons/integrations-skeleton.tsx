import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function IntegrationsSkeleton() {
  return (
    <PageSkeleton title="Integrations">
      <PageHeaderSkeleton hasDescription={true} actionCount={0} />

      <div className="space-y-4 max-w-4xl">
        {/* WhatsApp Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-72" />
            <div className="flex items-center gap-2 pt-1">
              <Skeleton className="h-9 w-36 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </CardBody>
        </Card>

        {/* Website Chat Widget Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-44" />
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-64" />
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </CardBody>
        </Card>

        {/* Google Calendar Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-36" />
            </div>
            <Skeleton className="h-5 w-24 rounded-full" />
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-3.5 w-80 max-w-full" />
            <Skeleton className="h-9 w-36 rounded-md" />
          </CardBody>
        </Card>
      </div>
    </PageSkeleton>
  );
}

export function ApiKeysSkeleton() {
  return (
    <PageSkeleton title="API Keys">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      <Card className="overflow-hidden">
        <CardHeader>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-36" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24 font-mono rounded" />
                </div>
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}

export function WebhooksSkeleton() {
  return (
    <PageSkeleton title="Webhooks">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-64 max-w-full font-mono" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Skeleton className="h-4 w-20 rounded" />
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-4 w-18 rounded" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
            <Skeleton className="h-3 w-56 pt-1" />
          </Card>
        ))}
      </div>
    </PageSkeleton>
  );
}
