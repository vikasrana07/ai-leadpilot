import { cn } from '@/lib/cn';

const TONES = ['bg-primary-soft text-accent-foreground', 'bg-success-soft text-success', 'bg-warning-soft text-warning', 'bg-danger-soft text-danger', 'bg-muted text-muted-foreground'];

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const tone = TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
  return (
    // Initials are drawn with CSS (not a text node): they are decoration, so they must not count as visible label text for accessible-name checks.
    <span aria-hidden data-initials={initials} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold before:content-[attr(data-initials)]", tone, className)} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }} />
  );
}
