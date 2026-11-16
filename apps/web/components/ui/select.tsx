import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Native select (accessible, mobile-friendly) styled to match inputs. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn('h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-foreground shadow-sm transition-colors hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-60', className)} {...props}>{children}</select>
  );
});
