'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, Columns3, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { ColumnDef } from './types';

interface ColumnVisibilityDropdownProps {
  columns: ColumnDef[];
  isColumnVisible: (id: string) => boolean;
  onToggleColumn: (id: string) => void;
  onResetColumns: () => void;
  onShowAllColumns: () => void;
}

export function ColumnVisibilityDropdown({
  columns,
  isColumnVisible,
  onToggleColumn,
  onResetColumns,
  onShowAllColumns,
}: ColumnVisibilityDropdownProps) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  // Filter out any columns that shouldn't appear in the menu (like row selection checkbox)
  const selectableColumns = columns.filter((c) => c.label.trim().length > 0);
  const hiddenCount = selectableColumns.filter((c) => !isColumnVisible(c.id)).length;

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Customize visible columns"
        >
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span>Columns</span>
          {hiddenCount > 0 ? (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold text-primary">
              -{hiddenCount}
            </span>
          ) : null}
        </button>
      </Menu.Trigger>
      <AnimatePresence>
        {open ? (
          <Menu.Portal forceMount>
            <Menu.Content
              asChild
              forceMount
              align="end"
              sideOffset={6}
              className="z-50 min-w-56 rounded-lg border border-border bg-card p-1 shadow-lg"
            >
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
              >
                <div className="flex items-center justify-between px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Toggle Columns
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onShowAllColumns()}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground/50">·</span>
                    <button
                      type="button"
                      onClick={() => onResetColumns()}
                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      title="Reset to default columns"
                    >
                      <RotateCcw className="h-2.5 w-2.5" aria-hidden />
                      Reset
                    </button>
                  </div>
                </div>
                <div className="my-1 h-px bg-border" role="separator" />

                <div className="max-h-64 overflow-y-auto py-0.5">
                  {selectableColumns.map((col) => {
                    const visible = isColumnVisible(col.id);
                    const disabled = !!col.alwaysVisible;

                    return (
                      <Menu.Item
                        key={col.id}
                        disabled={disabled}
                        onSelect={(e) => {
                          e.preventDefault();
                          if (!disabled) onToggleColumn(col.id);
                        }}
                        className={cn(
                          'flex cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted',
                          disabled && 'cursor-default opacity-50'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                              visible
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input bg-card'
                            )}
                          >
                            {visible ? <Check className="h-3 w-3 stroke-[3]" aria-hidden /> : null}
                          </span>
                          <span>{col.label}</span>
                        </span>
                        {disabled ? (
                          <span className="text-[10px] text-muted-foreground uppercase">Fixed</span>
                        ) : null}
                      </Menu.Item>
                    );
                  })}
                </div>
              </motion.div>
            </Menu.Content>
          </Menu.Portal>
        ) : null}
      </AnimatePresence>
    </Menu.Root>
  );
}
