import { cn } from '@/lib/cn';

interface LogoProps {
  tone?: 'default' | 'light';
  collapsed?: boolean;
  size?: number;
  className?: string;
}

/**
 * LeadPilot Brand Mark:
 * An aerodynamic supersonic delta wing navigating with dimensional facets
 * and an intelligent AI guidance beacon. Pure SVG matching theme tokens.
 */
export function Logo({
  tone = 'default',
  collapsed = false,
  size = 28,
  className,
}: LogoProps) {
  const isLight = tone === 'light';

  return (
    <span
      className={cn('inline-flex items-center gap-2.5 select-none', className)}
      aria-label="LeadPilot"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 transition-transform duration-200 group-hover:scale-105"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="lp-logo-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3F55E8" />
            <stop offset="100%" stopColor="#192284" />
          </linearGradient>
          <linearGradient id="lp-logo-highlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="lp-logo-wing-r" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EDF2FE" />
            <stop offset="100%" stopColor="#BAC8F8" />
          </linearGradient>
          <filter id="lp-logo-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#0E1433" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Squircle Base with Inset Bevel */}
        <rect width="32" height="32" rx="7.5" fill="url(#lp-logo-bg)" />
        <rect x="0.5" y="0.5" width="31" height="31" rx="7" stroke="url(#lp-logo-highlight)" />

        {/* Supersonic Pilot Wings */}
        <g filter="url(#lp-logo-shadow)">
          {/* Left Wing (brilliant primary facet) */}
          <path d="M16 6.5 L7.8 23.5 L16 19.5 Z" fill="#FFFFFF" />
          {/* Right Wing (sculpted dimensional facet) */}
          <path d="M16 6.5 L16 19.5 L24.2 23.5 Z" fill="url(#lp-logo-wing-r)" />
          {/* Center Spine Keel */}
          <line x1="16" y1="6.5" x2="16" y2="19.5" stroke="#FFFFFF" strokeWidth="0.4" strokeLinecap="round" />
        </g>

        {/* AI Guidance Beacon Pulse */}
        <circle cx="16" cy="22.2" r="1.8" fill="#38BDF8" opacity="0.9" />
        <circle cx="16" cy="22.2" r="0.75" fill="#FFFFFF" />
      </svg>

      {collapsed ? null : (
        <span
          className={cn(
            'text-[16px] font-semibold tracking-tight transition-colors',
            isLight ? 'text-white' : 'text-foreground'
          )}
        >
          Lead
          <span
            className={cn(
              'font-bold transition-colors',
              isLight ? 'text-[#8290ff]' : 'text-primary'
            )}
          >
            Pilot
          </span>
        </span>
      )}
    </span>
  );
}
