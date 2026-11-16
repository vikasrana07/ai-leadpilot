'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const OpenContext = createContext(false);
/** Element that had focus when the dialog opened: Radix can only restore focus to a <Trigger>, and most dialogs here are opened by app state. */
const ReturnFocusContext = createContext<{ current: HTMLElement | null }>({ current: null });

export function Dialog({ open: controlled, onOpenChange, children }: { open?: boolean; onOpenChange?: (o: boolean) => void; children: ReactNode }) {
  const [internal, setInternal] = useState(false);
  const open = controlled ?? internal;
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Layout effects run before Radix moves focus into the dialog, so this still sees the opener.
  useLayoutEffect(() => { if (open && !wasOpen.current) returnTo.current = document.activeElement as HTMLElement | null; wasOpen.current = open; }, [open]);
  return (
    <OpenContext.Provider value={open}>
      <ReturnFocusContext.Provider value={returnTo}>
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange ?? setInternal}>{children}</DialogPrimitive.Root>
      </ReturnFocusContext.Provider>
    </OpenContext.Provider>
  );
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  const open = useContext(OpenContext);
  const returnTo = useContext(ReturnFocusContext);
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div className="fixed inset-0 z-50 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content asChild forceMount aria-describedby={description ? undefined : undefined} onCloseAutoFocus={(e) => { const el = returnTo.current; if (el && document.contains(el)) { e.preventDefault(); el.focus(); } }}>
            <motion.div
              className={cn('fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-4 shadow-lg sm:p-6', className)}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 4 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <DialogPrimitive.Title className="text-heading">{title}</DialogPrimitive.Title>
                  {description ? <DialogPrimitive.Description className="text-helper mt-1">{description}</DialogPrimitive.Description> : null}
                </div>
                <DialogPrimitive.Close className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></DialogPrimitive.Close>
              </div>
              {children}
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}
