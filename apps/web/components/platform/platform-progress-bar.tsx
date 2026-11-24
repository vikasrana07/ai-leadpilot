'use client';

import { cn } from '@/lib/cn';

interface PlatformProgressBarProps {
  label: string;
  value: number;
  limit: number | null;
  unit?: string;
  className?: string;
}

export function PlatformProgressBar({
  label,
  value,
  limit,
  unit = '',
  className,
}: PlatformProgressBarProps) {
  const isUnlimited = limit === null || limit === undefined;
  const percentage = isUnlimited ? 0 : limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : 100;

  const toneColor =
    percentage >= 90
      ? 'bg-danger'
      : percentage >= 75
        ? 'bg-warning'
        : 'bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-foreground">{label}</span>
        <span className="num text-muted-foreground">
          <strong className="text-foreground">{value.toLocaleString('en-IN')}</strong>
          {isUnlimited ? ' / ∞' : ` / ${limit.toLocaleString('en-IN')}`} {unit}
          {!isUnlimited && <span className="ml-1.5 text-[11px] opacity-75">({percentage}%)</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all duration-500 rounded-full', isUnlimited ? 'bg-primary/40' : toneColor)}
          style={{ width: isUnlimited ? '15%' : `${Math.max(2, percentage)}%` }}
        />
      </div>
    </div>
  );
}
