import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2 text-base shadow-sm lg:text-[13px] transition-colors placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-60', className)} {...props} />;
});
