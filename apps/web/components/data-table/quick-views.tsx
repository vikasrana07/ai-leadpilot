'use client';

import { AlertCircle, Flame, Sparkles, User, Users } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface QuickViewItem {
  id: string;
  label: string;
  icon?: typeof Users;
  count?: number;
  tone?: 'default' | 'danger' | 'warning' | 'primary';
}

interface QuickViewsProps {
  activeId: string;
  items: QuickViewItem[];
  onSelect: (id: string) => void;
  className?: string;
}

export function QuickViews({ activeId, items, onSelect, className }: QuickViewsProps) {
  return (
    <div
      role="tablist"
      aria-label="Quick views"
      className={cn(
        'flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/20 px-3 py-1.5 scrollbar-none',
        className
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1 hidden sm:inline-block">
        Views:
      </span>
      {items.map((item) => {
        const active = activeId === item.id;
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(item.id)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer select-none',
              active
                ? 'bg-surface text-foreground shadow-xs border border-border text-primary font-semibold'
                : 'text-muted-foreground hover:bg-surface/60 hover:text-foreground'
            )}
          >
            {Icon ? (
              <Icon
                className={cn(
                  'h-3.5 w-3.5',
                  item.tone === 'danger' && 'text-danger',
                  item.tone === 'warning' && 'text-warning',
                  item.tone === 'primary' && 'text-primary'
                )}
                aria-hidden
              />
            ) : null}
            <span>{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 ? (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-semibold',
                  item.tone === 'danger'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
