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
  useLayoutEffect(() => {
    if (open && !wasOpen.current) returnTo.current = document.activeElement as HTMLElement | null;
    wasOpen.current = open;
  }, [open]);

  return (
    <OpenContext.Provider value={open}>
      <ReturnFocusContext.Provider value={returnTo}>
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange ?? setInternal}>
          {children}
        </DialogPrimitive.Root>
      </ReturnFocusContext.Provider>
    </OpenContext.Provider>
  );
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const sizeMap: Record<DrawerSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md', // 448px - tight single column forms (Webhook, API Key, Reset MFA)
  lg: 'sm:max-w-lg', // 512px
  xl: 'sm:max-w-xl', // 576px - standard forms (Tasks, Appointments, Edit Lead)
  '2xl': 'sm:max-w-2xl', // 672px - complex multi-column forms (Platform Plans, Property Config)
  full: 'sm:max-w-4xl',
};

export function DialogContent({
  title,
  description,
  children,
  footer,
  size = 'lg',
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: DrawerSize;
  className?: string;
}) {
  const open = useContext(OpenContext);
  const returnTo = useContext(ReturnFocusContext);
  const reduce = useReducedMotion();

  // Strip legacy center-modal positioning / max-h classes if passed by caller
  const cleanClassName = className
    ?.replace(/\bmax-h-\[[^\]]+\]/g, '')
    .replace(/\bmax-h-\w+/g, '')
    .replace(/\b-translate-[xy]-1\/2\b/g, '')
    .replace(/\btop-1\/2\b/g, '')
    .replace(/\bleft-1\/2\b/g, '')
    .trim();

  const hasCustomWidth = cleanClassName && /\b(sm:)?max-w-\w+\b/.test(cleanClassName);
  const widthClass = hasCustomWidth ? '' : (sizeMap[size] ?? 'sm:max-w-lg');

  return (
    <AnimatePresence>
      {open ? (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content
            asChild
            forceMount
            aria-describedby={description ? undefined : undefined}
            onCloseAutoFocus={(e) => {
              const el = returnTo.current;
              if (el && document.contains(el)) {
                e.preventDefault();
                el.focus();
              }
            }}
          >
            <motion.div
              className={cn(
                'fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l border-border bg-card shadow-2xl outline-none',
                widthClass,
                cleanClassName,
              )}
              initial={reduce ? { opacity: 0 } : { x: '100%' }}
              animate={reduce ? { opacity: 1 } : { x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: '100%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
                <div className="min-w-0 pr-2">
                  <DialogPrimitive.Title className="text-heading font-semibold text-foreground">
                    {title}
                  </DialogPrimitive.Title>
                  {description ? (
                    <DialogPrimitive.Description className="text-helper mt-1 text-[13px] text-muted-foreground">
                      {description}
                    </DialogPrimitive.Description>
                  ) : null}
                </div>
                <DialogPrimitive.Close
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>
              <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                {children}
              </div>
              {footer ? (
                <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-card px-5 py-3">
                  {footer}
                </div>
              ) : null}
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}

// Aliases for drawer usage
export const Drawer = Dialog;
export const DrawerTrigger = DialogTrigger;
export const DrawerClose = DialogClose;
export const DrawerContent = DialogContent;
export { FormErrorAlert, type FormErrorAlertProps } from './form-error-alert';
