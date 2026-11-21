'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { AlignJustify, Check, Rows3, StretchHorizontal } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { RowDensity } from './types';

interface RowHeightDropdownProps {
  density: RowDensity;
  onDensityChange: (density: RowDensity) => void;
}

const DENSITY_OPTIONS: { id: RowDensity; label: string; hint: string; icon: typeof Rows3 }[] = [
  { id: 'compact', label: 'Compact', hint: 'Dense spacing (32px)', icon: AlignJustify },
  { id: 'normal', label: 'Normal', hint: 'Default height (40px)', icon: Rows3 },
  { id: 'relaxed', label: 'Relaxed', hint: 'Spacious height (52px)', icon: StretchHorizontal },
];

export function RowHeightDropdown({ density, onDensityChange }: RowHeightDropdownProps) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Change row height density"
        >
          <Rows3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span>Row height</span>
        </button>
      </Menu.Trigger>
      <AnimatePresence>
        {open ? (
          <Menu.Portal forceMount>
            <Menu.Content asChild forceMount align="end" sideOffset={6}>
              <motion.div
                className="z-50 min-w-52 rounded-lg border border-border bg-card p-1 shadow-lg"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
              >
                <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Row Height
                </div>
                <div className="my-1 h-px bg-border" role="separator" />
                {DENSITY_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = density === opt.id;
                  return (
                    <Menu.Item
                      key={opt.id}
                      className={cn(
                        'flex cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted',
                        active && 'font-medium text-primary'
                      )}
                      onSelect={() => onDensityChange(opt.id)}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <div>
                          <div>{opt.label}</div>
                          <div className="text-[11px] text-muted-foreground font-normal">{opt.hint}</div>
                        </div>
                      </div>
                      {active ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
                    </Menu.Item>
                  );
                })}
              </motion.div>
            </Menu.Content>
          </Menu.Portal>
        ) : null}
      </AnimatePresence>
    </Menu.Root>
  );
}
