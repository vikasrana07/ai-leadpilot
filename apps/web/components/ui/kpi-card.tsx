import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { CountUp } from './count-up';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/cn';

/** KPI tile: label, animated value, delta vs prev., trend sparkline. `goodWhen` says whether "up" is good. */
export function KpiCard({ label, value, deltaPct, trend, goodWhen = 'up', hint, suffix, className }: { label: string; value: number; deltaPct: number | null; trend?: number[]; goodWhen?: 'up' | 'down'; hint?: string; suffix?: string; className?: string }) {
  const up = (deltaPct ?? 0) >= 0;
  const good = (up && goodWhen === 'up') || (!up && goodWhen === 'down');
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn('flex items-end justify-between gap-3 rounded-lg border border-border bg-card p-3.5 shadow-sm', className)}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-muted-foreground" title={hint}>{label}</p>
        <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight"><CountUp value={value} format={Number.isInteger(value) ? undefined : (n) => n.toFixed(1)} />{suffix ? <span className="ml-0.5 text-[15px] text-muted-foreground">{suffix}</span> : null}</p>
        {deltaPct === null ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint ?? 'No earlier period to compare'}</p> : <p className={cn('num mt-1.5 flex items-center gap-1 text-[11px] font-medium', good ? 'text-success' : 'text-danger')}><Arrow className="h-3.5 w-3.5" aria-hidden />{Math.abs(deltaPct)}%<span className="font-normal text-muted-foreground">vs prev.</span></p>}
      </div>
      {trend && trend.length > 1 ? <Sparkline data={trend} tone={good ? 'success' : 'danger'} width={88} height={36} /> : null}
    </div>
  );
}
