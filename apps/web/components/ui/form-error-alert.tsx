'use client';

import { AlertCircle } from 'lucide-react';
import type { FieldErrors } from 'react-hook-form';
import { cn } from '@/lib/cn';

export interface FormErrorAlertProps {
  errors?: FieldErrors | Record<string, unknown> | null;
  message?: string;
  className?: string;
}

function extractErrorMessages(errors?: FieldErrors | Record<string, unknown> | null): string[] {
  if (!errors || typeof errors !== 'object') return [];
  const messages: string[] = [];

  function traverse(obj: unknown) {
    if (!obj || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      messages.push(record.message.trim());
      return;
    }
    for (const key of Object.keys(record)) {
      if (key === 'ref') continue;
      traverse(record[key]);
    }
  }

  traverse(errors);
  return Array.from(new Set(messages));
}

/**
 * Top-level form error alert with aria-live="polite".
 * Ensures screen readers immediately announce validation failures when a drawer or dialog form
 * is submitted with missing or invalid inputs.
 */
export function FormErrorAlert({ errors, message, className }: FormErrorAlertProps) {
  const extracted = extractErrorMessages(errors);
  const hasErrors = Boolean(message || extracted.length > 0);

  if (!hasErrors) {
    return null;
  }

  const title =
    message ??
    (extracted.length === 1
      ? 'Please fix the error below before submitting:'
      : `Please fix the ${extracted.length} errors below before submitting:`);

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="form-error-alert"
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger-soft p-3 text-[13px] text-danger',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-snug">{title}</p>
        {extracted.length > 0 && !message ? (
          <ul className="list-disc pl-4 text-[12px] space-y-0.5 text-danger/90">
            {extracted.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
