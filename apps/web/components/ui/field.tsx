import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Label + control + error/hint. The error and hint are programmatically tied to the control (`aria-describedby`, `aria-invalid`) so screen
 * readers announce them with the field; the error is also a live alert. Works when the control is the direct child with `id={htmlFor}`.
 */
export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string | undefined; hint?: string; children: ReactNode; className?: string }) {
  const descId = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  const child = isValidElement(children) && (children.props as { id?: string }).id === htmlFor
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { ...(descId ? { 'aria-describedby': [((children.props as Record<string, unknown>)['aria-describedby'] as string | undefined), descId].filter(Boolean).join(' ') } : {}), ...(error ? { 'aria-invalid': true } : {}) })
    : children;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="text-label block text-foreground">{label}</label>
      {child}
      {error ? <p id={`${htmlFor}-error`} role="alert" className="text-helper !text-danger">{error}</p> : hint ? <p id={`${htmlFor}-hint`} className="text-helper">{hint}</p> : null}
    </div>
  );
}
