import { cn } from '@/lib/cn';

/** Wordmark: a flight-path chevron inside a rounded square. Pure SVG so it follows theme tokens. */
export function Logo({ tone = 'default', collapsed = false }: { tone?: 'default' | 'light'; collapsed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <rect width="28" height="28" rx="7" className="fill-primary" />
        <path d="M8 18.5 14 8l6 10.5-6-2.6-6 2.6Z" fill="white" />
      </svg>
      {collapsed ? null : <span className={cn('text-[16px] font-semibold tracking-tight', tone === 'light' ? 'text-white' : 'text-foreground')}>LeadPilot</span>}
    </span>
  );
}
