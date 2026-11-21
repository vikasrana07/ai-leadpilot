'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { FilterPopover } from './filter-popover';
import type { FilterDimension } from './types';

interface FilterPillProps {
  dimension: FilterDimension;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  onRemove?: () => void;
  /** Whether the pill should be shown even if no values are selected */
  alwaysVisible?: boolean;
}

export function FilterPill({
  dimension,
  selectedValues,
  onChange,
  onRemove,
  alwaysVisible = false,
}: FilterPillProps) {
  const [open, setOpen] = useState(false);
  const hasValue = selectedValues.length > 0;

  if (!hasValue && !alwaysVisible) {
    return null;
  }

  const Icon = dimension.icon;

  // Resolve display label for selected value(s)
  let displayValue: string | null = null;
  if (selectedValues.length === 1 && selectedValues[0] !== undefined) {
    const val = selectedValues[0];
    const opt = dimension.options.find((o) => o.value === val);
    displayValue = opt?.label ?? val;
  }

  const trigger = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        'group inline-flex h-7 items-center gap-1.5 rounded-md border text-[12px] font-medium transition-all select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        hasValue
          ? 'border-primary/40 bg-primary-soft/60 text-primary-hover hover:bg-primary-soft/90 dark:bg-primary-soft/20 dark:text-primary-soft'
          : 'border-border/80 bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      style={{ paddingLeft: '8px', paddingRight: hasValue ? '4px' : '8px' }}
      aria-label={`Filter by ${dimension.label}`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden /> : null}

      <span>{dimension.label}</span>

      {hasValue ? (
        <>
          <span className="opacity-40">·</span>
          {displayValue ? (
            <span className="max-w-28 truncate font-semibold text-foreground">
              {displayValue}
            </span>
          ) : (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {selectedValues.length}
            </span>
          )}

          {/* Remove / Clear button */}
          <button
            type="button"
            aria-label={`Clear ${dimension.label} filter`}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
              onRemove?.();
            }}
            className="ml-0.5 rounded p-0.5 text-muted-foreground/80 hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      ) : null}
    </div>
  );

  return (
    <FilterPopover
      dimension={dimension}
      selectedValues={selectedValues}
      onChange={onChange}
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
