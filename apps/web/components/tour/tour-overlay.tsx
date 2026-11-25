'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, HelpCircle, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { TourPlacement, TourStep } from '@/lib/tours/types';
import { useHelpTour } from './help-tour-provider';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PAD = 8;
const POPOVER_GAP = 14;
const POPOVER_WIDTH = 340;
const VIEWPORT_MARGIN = 12;

export function computePopoverPosition(
  targetRect: Rect | null,
  popoverSize: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: TourPlacement = 'bottom',
): { top: number; left: number; centered: boolean } {
  if (!targetRect || preferred === 'center' || viewport.width < 520) {
    return {
      top: Math.max(VIEWPORT_MARGIN, Math.round((viewport.height - popoverSize.height) / 2)),
      left: Math.max(VIEWPORT_MARGIN, Math.round((viewport.width - popoverSize.width) / 2)),
      centered: true,
    };
  }

  const paddedTop = targetRect.top - SPOTLIGHT_PAD;
  const paddedLeft = targetRect.left - SPOTLIGHT_PAD;
  const paddedRight = targetRect.left + targetRect.width + SPOTLIGHT_PAD;
  const paddedBottom = targetRect.top + targetRect.height + SPOTLIGHT_PAD;

  const fitsBottom = paddedBottom + POPOVER_GAP + popoverSize.height + VIEWPORT_MARGIN <= viewport.height;
  const fitsTop = paddedTop - POPOVER_GAP - popoverSize.height >= VIEWPORT_MARGIN;
  const fitsRight = paddedRight + POPOVER_GAP + popoverSize.width + VIEWPORT_MARGIN <= viewport.width;
  const fitsLeft = paddedLeft - POPOVER_GAP - popoverSize.width >= VIEWPORT_MARGIN;

  let placement: TourPlacement = preferred;
  if (placement === 'bottom' && !fitsBottom) placement = fitsTop ? 'top' : fitsRight ? 'right' : fitsLeft ? 'left' : 'center';
  if (placement === 'top' && !fitsTop) placement = fitsBottom ? 'bottom' : fitsRight ? 'right' : fitsLeft ? 'left' : 'center';
  if (placement === 'right' && !fitsRight) placement = fitsLeft ? 'left' : fitsBottom ? 'bottom' : fitsTop ? 'top' : 'center';
  if (placement === 'left' && !fitsLeft) placement = fitsRight ? 'right' : fitsBottom ? 'bottom' : fitsTop ? 'top' : 'center';

  if (placement === 'center') {
    return {
      top: Math.max(VIEWPORT_MARGIN, Math.round((viewport.height - popoverSize.height) / 2)),
      left: Math.max(VIEWPORT_MARGIN, Math.round((viewport.width - popoverSize.width) / 2)),
      centered: true,
    };
  }

  const clampX = (x: number) => Math.min(Math.max(VIEWPORT_MARGIN, x), viewport.width - popoverSize.width - VIEWPORT_MARGIN);
  const clampY = (y: number) => Math.min(Math.max(VIEWPORT_MARGIN, y), viewport.height - popoverSize.height - VIEWPORT_MARGIN);

  if (placement === 'bottom') {
    return {
      top: clampY(paddedBottom + POPOVER_GAP),
      left: clampX(targetRect.left + targetRect.width / 2 - popoverSize.width / 2),
      centered: false,
    };
  }
  if (placement === 'top') {
    return {
      top: clampY(paddedTop - POPOVER_GAP - popoverSize.height),
      left: clampX(targetRect.left + targetRect.width / 2 - popoverSize.width / 2),
      centered: false,
    };
  }
  if (placement === 'right') {
    return {
      top: clampY(targetRect.top + targetRect.height / 2 - popoverSize.height / 2),
      left: clampX(paddedRight + POPOVER_GAP),
      centered: false,
    };
  }
  return {
    top: clampY(targetRect.top + targetRect.height / 2 - popoverSize.height / 2),
    left: clampX(paddedLeft - POPOVER_GAP - popoverSize.width),
    centered: false,
  };
}

export function TourCard({
  tourTitle,
  step,
  stepIndex,
  totalSteps,
  onPrev,
  onNext,
  onClose,
}: {
  tourTitle: string;
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  return (
    <div aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tourTitle}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help tour"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div>
        <h2 id={titleId} className="text-[15px] font-semibold text-foreground">
          {step.title}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {step.description}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-[12px] font-medium text-muted-foreground" aria-live="polite">
          Step {stepIndex + 1} of {totalSteps}
        </span>
        <div className="flex items-center gap-1.5">
          {!isFirst ? (
            <Button type="button" variant="ghost" size="sm" onClick={onPrev}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Back
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Skip
            </Button>
          )}
          <Button type="button" variant="primary" size="sm" onClick={onNext}>
            {isLast ? 'Done' : 'Next'}
            {!isLast ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TourOverlay() {
  const { activeTour, steps, stepIndex, currentStep, stopTour, nextStep, prevStep } = useHelpTour();
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [popoverSize, setPopoverSize] = useState({ width: POPOVER_WIDTH, height: 190 });
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const isOpen = Boolean(activeTour && currentStep);

  useLayoutEffect(() => {
    if (isOpen && !wasOpen.current) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    if (!isOpen && wasOpen.current) {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && document.contains(opener)) opener.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    popoverRef.current?.focus();
  }, [isOpen, stepIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopTour(true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextStep();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevStep();
      } else if (e.key === 'Tab' && popoverRef.current) {
        const focusable = popoverRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, nextStep, prevStep, stopTour]);

  useEffect(() => {
    if (!isOpen || !currentStep) {
      setTargetRect(null);
      return;
    }

    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      if (popoverRef.current) {
        const pRect = popoverRef.current.getBoundingClientRect();
        if (pRect.width > 0 && pRect.height > 0) {
          setPopoverSize({ width: pRect.width, height: pRect.height });
        }
      }
      if (!currentStep.target) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(currentStep.target)}"]`);
      if (!el) {
        setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect(r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };

    if (currentStep.target) {
      const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(currentStep.target)}"]`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro = new ResizeObserver(update);
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro.disconnect();
    };
  }, [isOpen, currentStep]);

  if (!isOpen || !activeTour || !currentStep) return null;

  const pos = computePopoverPosition(
    targetRect,
    { width: Math.min(POPOVER_WIDTH, viewport.width - VIEWPORT_MARGIN * 2), height: popoverSize.height },
    viewport,
    currentStep.placement,
  );

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[60]"
        role="dialog"
        aria-modal="true"
        aria-label={`${activeTour.title} help tour`}
      >
        {/* Backdrop: click outside closes tour */}
        {targetRect ? (
          <>
            <div className="fixed inset-0 bg-transparent" onClick={() => stopTour(true)} aria-hidden />
            <motion.div
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all duration-200"
              style={{
                top: Math.max(4, targetRect.top - SPOTLIGHT_PAD),
                left: Math.max(4, targetRect.left - SPOTLIGHT_PAD),
                width: targetRect.width + SPOTLIGHT_PAD * 2,
                height: targetRect.height + SPOTLIGHT_PAD * 2,
                boxShadow: '0 0 0 9999px rgba(10, 13, 19, 0.58)',
              }}
            />
          </>
        ) : (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => stopTour(true)}
            className="fixed inset-0 bg-black/55"
          />
        )}

        <motion.div
          ref={popoverRef}
          tabIndex={-1}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
          style={{
            top: pos.top,
            left: pos.left,
            width: Math.min(POPOVER_WIDTH, viewport.width - VIEWPORT_MARGIN * 2),
          }}
          className={cn(
            'fixed z-[61] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg focus:outline-none',
          )}
        >
          <TourCard
            tourTitle={activeTour.title}
            step={currentStep}
            stepIndex={stepIndex}
            totalSteps={steps.length}
            onPrev={prevStep}
            onNext={nextStep}
            onClose={() => stopTour(true)}
          />
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
