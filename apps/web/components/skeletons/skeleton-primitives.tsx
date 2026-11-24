import type { HTMLAttributes, ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

export interface PageSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  children: ReactNode;
  className?: string;
}

export function PageSkeleton({ title, children, className, ...props }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Loading ${title}`}
      className={cn('space-y-4 animate-in fade-in duration-150', className)}
      {...props}
    >
      <span className="sr-only">Loading {title}...</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({
  hasBreadcrumbs = false,
  hasDescription = true,
  actionCount = 1,
  className,
}: {
  hasBreadcrumbs?: boolean;
  hasDescription?: boolean;
  actionCount?: number;
  className?: string;
}) {
  return (
    <div className={cn('mb-4', className)}>
      {hasBreadcrumbs && (
        <div className="mb-2 flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-16" />
          <span className="text-muted-foreground/40 text-xs">/</span>
          <Skeleton className="h-3.5 w-24" />
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-44 rounded-md" />
          {hasDescription && <Skeleton className="h-4 w-72 max-w-full rounded" />}
        </div>
        {actionCount > 0 && (
          <div className="flex items-center gap-2">
            {Array.from({ length: actionCount }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn('h-9 rounded-md', i === 0 && actionCount > 1 ? 'w-24' : 'w-32')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function KpiCardSkeleton({ hasTrend = true }: { hasTrend?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 rounded-lg border border-border bg-card p-3.5 shadow-xs">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-7 w-20 rounded" />
        <Skeleton className="h-3 w-32" />
      </div>
      {hasTrend && <Skeleton className="h-9 w-20 shrink-0 rounded" />}
    </div>
  );
}

export function FilterPillsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-8 rounded-full', i === 0 ? 'w-20' : i === 1 ? 'w-24' : 'w-16')}
        />
      ))}
    </div>
  );
}

export function TabsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="mb-3 flex gap-2 border-b border-border pb-1" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-28 rounded-md" />
      ))}
    </div>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 6,
  hasCheckbox = false,
  hasActions = true,
}: {
  columns?: number;
  rows?: number;
  hasCheckbox?: boolean;
  hasActions?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      {/* Table Header */}
      <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-3">
        {hasCheckbox && <Skeleton className="h-4 w-4 rounded" />}
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              'h-3.5 rounded',
              i === 0 ? 'w-32' : i === columns - 1 && hasActions ? 'ml-auto w-16' : 'w-24'
            )}
          />
        ))}
      </div>
      {/* Table Rows */}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {hasCheckbox && <Skeleton className="h-4 w-4 rounded" />}
            {/* Lead / Title cell with avatar on first column if applicable */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
            {Array.from({ length: columns - 1 }).map((_, c) => (
              <div
                key={c}
                className={cn(
                  'hidden sm:block',
                  c === columns - 2 && hasActions ? 'ml-auto flex justify-end' : ''
                )}
              >
                {c === 0 ? (
                  <Skeleton className="h-5 w-20 rounded-full" />
                ) : c === columns - 2 && hasActions ? (
                  <Skeleton className="h-7 w-7 rounded-md" />
                ) : (
                  <Skeleton className="h-3.5 w-20" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
