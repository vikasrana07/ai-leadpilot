'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { platformApi, type OpsView } from '@/lib/platform';
import { cn } from '@/lib/cn';

export function SystemStatusPill() {
  const q = useQuery({
    queryKey: ['platform-ops-summary'],
    queryFn: () => platformApi<OpsView>('/ops'),
    refetchInterval: 30_000,
    retry: false,
  });

  const firing = q.data?.firing?.length ?? 0;
  const isStale = q.data?.snapshot?.stale ?? false;
  const hasError = q.isError;

  let tone = 'bg-success-soft text-success border-success/30';
  let dotColor = 'bg-emerald-500';
  let label = 'Systems Normal';
  let Icon = CheckCircle2;

  if (hasError) {
    tone = 'bg-muted text-muted-foreground border-border';
    dotColor = 'bg-slate-400';
    label = 'Status Unavailable';
    Icon = Activity;
  } else if (firing > 0) {
    tone = 'bg-danger-soft text-danger border-danger/30';
    dotColor = 'bg-rose-500';
    label = `${firing} ${firing === 1 ? 'Alert' : 'Alerts'} Firing`;
    Icon = AlertTriangle;
  } else if (isStale) {
    tone = 'bg-warning-soft text-warning border-warning/30';
    dotColor = 'bg-amber-500';
    label = 'Worker Stale';
    Icon = AlertTriangle;
  }

  return (
    <Link
      href="/platform/ops"
      className={cn(
        'group flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all hover:shadow-xs',
        tone
      )}
      title="View Operations Status"
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            dotColor
          )}
        />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotColor)} />
      </span>
      <span className="hidden sm:inline">{label}</span>
      <Icon className="h-3 w-3 sm:hidden" aria-hidden />
    </Link>
  );
}
