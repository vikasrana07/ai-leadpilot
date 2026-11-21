'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, Search, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { FilterDimension } from './types';

interface FilterPopoverProps {
  dimension: FilterDimension;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FilterPopover({
  dimension,
  selectedValues,
  onChange,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: FilterPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setUncontrolledOpen;

  const [search, setSearch] = useState('');
  const reduce = useReducedMotion();

  const isMulti = dimension.mode !== 'single';

  const filteredOptions = dimension.options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  const toggleValue = (value: string) => {
    if (isMulti) {
      if (selectedValues.includes(value)) {
        onChange(selectedValues.filter((v) => v !== value));
      } else {
        onChange([...selectedValues, value]);
      }
    } else {
      if (selectedValues.includes(value)) {
        onChange([]);
      } else {
        onChange([value]);
        setOpen(false);
      }
    }
  };

  const selectAll = () => {
    onChange(dimension.options.map((o) => o.value));
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <AnimatePresence>
        {open ? (
          <Menu.Portal forceMount>
            <Menu.Content
              asChild
              forceMount
              align="start"
              sideOffset={6}
              className="z-50 w-64 rounded-lg border border-border bg-card shadow-lg outline-none"
            >
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                onKeyDown={(e) => {
                  // Prevent typing space in search from triggering menu selection
                  if (e.key === ' ') e.stopPropagation();
                }}
              >
                {/* Search Header */}
                <div className="p-2 border-b border-border">
                  <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <input
                      type="text"
                      className="w-full rounded-md border border-input/60 bg-muted/40 py-1 pl-7 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={dimension.placeholder ?? `Find ${dimension.label.toLowerCase()}…`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoFocus
                    />
                    {search ? (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        className="absolute right-2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Subheader with Dimension Name & Quick actions */}
                <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <span>{dimension.label}</span>
                  {isMulti ? (
                    <div className="flex items-center gap-1.5 normal-case font-normal text-[11px]">
                      <button
                        type="button"
                        onClick={selectAll}
                        className="font-medium text-primary hover:underline"
                      >
                        ALL
                      </button>
                      <span className="text-muted-foreground/40">/</span>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        NONE
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Options List */}
                <div className="max-h-56 overflow-y-auto px-1 pb-1">
                  {filteredOptions.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                      No matching options
                    </div>
                  ) : (
                    filteredOptions.map((opt) => {
                      const selected = selectedValues.includes(opt.value);
                      return (
                        <Menu.Item
                          key={opt.value}
                          onSelect={(e) => {
                            e.preventDefault();
                            toggleValue(opt.value);
                          }}
                          className={cn(
                            'flex cursor-pointer select-none items-center justify-between rounded-md px-2 py-1.5 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted',
                            selected && 'bg-primary-soft/40 font-medium text-foreground'
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                                selected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-input bg-card'
                              )}
                            >
                              {selected ? <Check className="h-3 w-3 stroke-[3]" aria-hidden /> : null}
                            </span>

                            {opt.dotColor ? (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: opt.dotColor }}
                                aria-hidden
                              />
                            ) : null}

                            {opt.icon ? <span className="shrink-0">{opt.icon}</span> : null}

                            <span className="truncate">{opt.label}</span>
                          </div>

                          {opt.badge ? (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {opt.badge}
                            </span>
                          ) : null}
                        </Menu.Item>
                      );
                    })
                  )}
                </div>
              </motion.div>
            </Menu.Content>
          </Menu.Portal>
        ) : null}
      </AnimatePresence>
    </Menu.Root>
  );
}
