'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { Plus, Search } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { FilterDimension } from './types';

interface AddFilterMenuProps {
  dimensions: FilterDimension[];
  activeDimensionIds: string[];
  onSelectDimension: (dimensionId: string) => void;
  booleanFilters?: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }[];
}

export function AddFilterMenu({
  dimensions,
  activeDimensionIds,
  onSelectDimension,
  booleanFilters = [],
}: AddFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const reduce = useReducedMotion();

  const availableDimensions = dimensions.filter((d) =>
    d.label.toLowerCase().includes(search.toLowerCase())
  );

  const availableBooleans = booleanFilters.filter(
    (b) => !b.checked && b.label.toLowerCase().includes(search.toLowerCase())
  );

  const hasAny = availableDimensions.length > 0 || availableBooleans.length > 0;

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border bg-card/60 px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Add filter"
        >
          <Plus className="h-3 w-3" aria-hidden />
          <span>Filter</span>
        </button>
      </Menu.Trigger>
      <AnimatePresence>
        {open ? (
          <Menu.Portal forceMount>
            <Menu.Content
              asChild
              forceMount
              align="start"
              sideOffset={6}
              className="z-50 min-w-48 rounded-lg border border-border bg-card shadow-lg outline-none"
            >
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                onKeyDown={(e) => {
                  if (e.key === ' ') e.stopPropagation();
                }}
              >
                {/* Search Header */}
                <div className="p-1.5 border-b border-border">
                  <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <input
                      type="text"
                      className="w-full rounded-md border border-input/60 bg-muted/40 py-1 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Filter by…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto p-1">
                  {!hasAny ? (
                    <div className="px-2.5 py-3 text-center text-[12px] text-muted-foreground">
                      No matching filters
                    </div>
                  ) : (
                    <>
                      {availableDimensions.map((dim) => {
                        const Icon = dim.icon;
                        const isActive = activeDimensionIds.includes(dim.id);

                        return (
                          <Menu.Item
                            key={dim.id}
                            onSelect={() => {
                              onSelectDimension(dim.id);
                            }}
                            className={cn(
                              'flex cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted',
                              isActive && 'text-primary font-medium'
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {Icon ? (
                                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                              ) : null}
                              <span>{dim.label}</span>
                            </div>

                            {isActive ? (
                              <span className="text-[10px] text-primary uppercase font-semibold">
                                Active
                              </span>
                            ) : null}
                          </Menu.Item>
                        );
                      })}

                      {availableBooleans.map((b) => (
                        <Menu.Item
                          key={b.id}
                          onSelect={() => {
                            b.onChange(true);
                          }}
                          className="flex cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{b.label}</span>
                          </div>
                        </Menu.Item>
                      ))}
                    </>
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
