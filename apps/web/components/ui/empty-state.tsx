import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-surface shadow-sm">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
      </div>
      <h3 className="text-heading">{title}</h3>
      <p className="text-helper mt-1 max-w-sm">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
