'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardBody } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface PlatformKpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  badge?: ReactNode;
  hint?: string;
  trend?: {
    value: string;
    positive?: boolean;
    label?: string;
  };
  className?: string;
}

export function PlatformKpiCard({
  label,
  value,
  icon: Icon,
  badge,
  hint,
  trend,
  className,
}: PlatformKpiCardProps) {
  return (
    <Card className={cn('relative overflow-hidden transition-all hover:border-border-strong hover:shadow-md', className)}>
      <CardBody className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          {Icon ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Icon className="h-4.5 w-4.5" aria-hidden />
            </div>
          ) : badge}
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <p className="num text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">
            {value}
          </p>
          {trend ? (
            <span
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                trend.positive
                  ? 'bg-success-soft text-success'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {trend.value}
            </span>
          ) : null}
        </div>

        {hint ? (
          <p className="text-helper mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
