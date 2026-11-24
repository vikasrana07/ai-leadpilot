import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, PageSkeleton } from './skeleton-primitives';

export function AppointmentsCalendarSkeleton() {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-7 divide-x divide-border">
        {Array.from({ length: 7 }).map((_, day) => (
          <div key={day} className="min-h-72 p-2 space-y-2">
            {/* Day Header */}
            <div className="mb-2 pb-1 border-b border-border/40">
              <Skeleton className="h-3.5 w-20" />
            </div>

            {/* Appointment Chips in this day */}
            {day % 2 === 0 ? (
              <div className="space-y-2">
                <div className="rounded-md border border-border bg-card p-2 space-y-1.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-4 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                {day === 2 || day === 4 ? (
                  <div className="rounded-md border border-border bg-card p-2 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-4 w-12 rounded-full" />
                    </div>
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                ) : null}
              </div>
            ) : day === 1 ? (
              <div className="rounded-md border border-border bg-card p-2 space-y-1.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-14" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppointmentsTableSkeleton() {
  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-28 flex-1" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-16 text-right" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-4 w-32 flex-1" />
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-4 w-12 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppointmentsSkeleton({ view = 'week' }: { view?: 'week' | 'list' }) {
  return (
    <PageSkeleton title="Appointments">
      <PageHeaderSkeleton hasDescription={true} actionCount={2} />

      <Card className="overflow-hidden">
        {/* Sticky Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border bg-card p-3">
          <div className="flex items-center gap-2">
            {/* View Switcher: Week / List */}
            <div className="flex rounded-md border border-border p-0.5">
              <Skeleton className="h-7 w-16 rounded" />
              <Skeleton className="h-7 w-20 rounded" />
            </div>

            {/* Date Navigator */}
            <div className="flex items-center gap-1">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-14 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-4 w-36 ml-1" />
            </div>
          </div>

          {/* Practitioner Filter */}
          <Skeleton className="h-8 w-36 rounded-md" />
        </div>

        {view === 'week' ? <AppointmentsCalendarSkeleton /> : <AppointmentsTableSkeleton />}
      </Card>
    </PageSkeleton>
  );
}
