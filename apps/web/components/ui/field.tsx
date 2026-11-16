import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string | undefined; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="text-label block text-foreground">{label}</label>
      {children}
      {error ? <p role="alert" className="text-helper !text-danger">{error}</p> : hint ? <p className="text-helper">{hint}</p> : null}
    </div>
  );
}
