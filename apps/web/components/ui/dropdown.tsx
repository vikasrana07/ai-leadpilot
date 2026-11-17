'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const OpenContext = createContext(false);

export function Dropdown({ trigger, children, align = 'end', className, onCloseAutoFocus }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; className?: string; /** Call preventDefault() to keep focus where the caller put it instead of returning it to the trigger. */ onCloseAutoFocus?: (e: Event) => void }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <OpenContext.Provider value={open}>
      <Menu.Root open={open} onOpenChange={setOpen}>
        {/* The shared Button is a motion.button: pressing Enter on it makes framer-motion fire a synthetic pointerdown, which Radix would treat as a
            second click and toggle the menu straight back shut. Ignore pointer events the browser did not generate. */}
        <Menu.Trigger asChild onPointerDown={(e) => { if (!e.nativeEvent.isTrusted) e.preventDefault(); }}>{trigger}</Menu.Trigger>
        <AnimatePresence>
          {open ? (
            <Menu.Portal forceMount>
              <Menu.Content asChild forceMount align={align} sideOffset={6} {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
                <motion.div
                  className={cn('z-50 min-w-48 rounded-lg border border-border bg-card p-1 shadow-lg', className)}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                >
                  {children}
                </motion.div>
              </Menu.Content>
            </Menu.Portal>
          ) : null}
        </AnimatePresence>
      </Menu.Root>
    </OpenContext.Provider>
  );
}

export function DropdownItem({ className, onSelect, danger, children, ...props }: Omit<Menu.DropdownMenuItemProps, 'onSelect'> & { onSelect?: () => void; danger?: boolean }) {
  useContext(OpenContext);
  return (
    <Menu.Item
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-muted', danger ? 'text-danger' : 'text-foreground', className)}
      onSelect={() => onSelect?.()}
      {...props}
    >
      {children}
    </Menu.Item>
  );
}
export const DropdownLabel = ({ children }: { children: ReactNode }) => <div className="text-label px-2.5 py-1.5 text-muted-foreground">{children}</div>;
export const DropdownSeparator = () => <div className="my-1 h-px bg-border" role="separator" />;
