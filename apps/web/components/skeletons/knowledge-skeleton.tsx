import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function KnowledgeSkeleton() {
  return (
    <PageSkeleton title="Knowledge Base">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* Upload Dropzone Mockup */}
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card p-8 text-center space-y-2">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>

      {/* Documents List Card */}
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-6 rounded-full" />
          </div>
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-18 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}

export function AiAssistantSkeleton() {
  return (
    <PageSkeleton title="AI Assistant">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* Token Usage Meter */}
      <Card className="p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </Card>

      {/* Tabs Bar */}
      <div className="flex gap-4 border-b border-border pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>

      {/* Form Cards */}
      <div className="space-y-4 max-w-3xl">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Sticky Save Bar */}
        <div className="flex justify-end pt-2">
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>
    </PageSkeleton>
  );
}

export function ReportsSkeleton() {
  return (
    <PageSkeleton title="Reports">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      {/* Date Range Selector */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {['w-16', 'w-18', 'w-18', 'w-24', 'w-18'].map((w, i) => (
          <Skeleton key={i} className={`h-8 ${w} rounded-full`} />
        ))}
      </div>

      {/* Report Tabs */}
      <div className="flex gap-4 border-b border-border pb-2 mb-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-28" />
      </div>

      {/* 4 Summary KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2 shadow-xs">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      {/* Chart Card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-24" />
        </CardHeader>
        <CardBody className="h-64 flex items-end gap-3 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div
                className="w-full rounded-t bg-muted/60 skeleton"
                style={{ height: `${25 + (i * 10) % 70}%` }}
              />
              <Skeleton className="h-2.5 w-10" />
            </div>
          ))}
        </CardBody>
      </Card>
    </PageSkeleton>
  );
}

export function AuditSkeleton() {
  return (
    <PageSkeleton title="Audit Log">
      <PageHeaderSkeleton hasDescription={true} actionCount={1} />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-5 py-2.5 text-xs">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-64 flex-1" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-5 w-28 rounded" />
              <Skeleton className="h-3.5 w-64 flex-1" />
              <Skeleton className="h-3.5 w-24 font-mono text-xs" />
            </div>
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}
