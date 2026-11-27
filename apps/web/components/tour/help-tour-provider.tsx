'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/pack';
import { ALL_TOURS, matchTourRoute, reconcileIndex, resolveSteps, sameStepIds } from '@/lib/tours';
import type { ScreenTour, TourStep } from '@/lib/tours/types';

const STORAGE_PREFIX = 'lp:tour:seen:';
/** While a tour is open, how often (at most) the visible steps are re-checked as the page changes. */
const RESOLVE_INTERVAL_MS = 150;

export interface HelpTourContextValue {
  activeTour: ScreenTour | null;
  steps: TourStep[];
  stepIndex: number;
  currentStep: TourStep | null;
  currentRouteTour: ScreenTour | undefined;
  hasTourForCurrentRoute: boolean;
  isCurrentRouteSeen: boolean;
  startTour: (tourId?: string) => void;
  stopTour: (markSeen?: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetSeenTours: () => void;
}

const HelpTourContext = createContext<HelpTourContextValue | null>(null);

function isTargetVisible(targetId: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(targetId)}"]`);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function readSeenIds(storageKey: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function HelpTourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ctx } = useAuth();
  const terms = useTerms();
  const storageKey = `${STORAGE_PREFIX}${ctx.user.id}`;

  const [seenIds, setSeenIds] = useState<string[]>(() => readSeenIds(storageKey));
  const [activeTour, setActiveTour] = useState<ScreenTour | null>(null);
  // The tour's full step list, and the subset whose targets are on screen right now (`steps`). The subset is re-resolved while the tour is
  // open, so a tour opened over a loading skeleton gains its steps as the page's data arrives instead of staying collapsed.
  const [allSteps, setAllSteps] = useState<TourStep[]>([]);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const stepsRef = useRef<TourStep[]>([]);
  const stepIndexRef = useRef(0);
  useEffect(() => {
    stepsRef.current = steps;
    stepIndexRef.current = stepIndex;
  }, [steps, stepIndex]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs seen tour IDs when user changes
    setSeenIds(readSeenIds(storageKey));
  }, [storageKey]);

  // Close an active tour when navigating to another screen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets active tour on route change
    setActiveTour(null);
    setAllSteps([]);
    setSteps([]);
    setStepIndex(0);
  }, [pathname]);

  // Re-resolve the visible steps while a tour is open: targets can appear (data loaded) or disappear (panel closed). The user keeps their
  // place by step id. Mutations are throttled, and nothing is set when the visible steps did not change.
  useEffect(() => {
    if (!activeTour || allSteps.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recompute = () => {
      timer = null;
      const next = resolveSteps(allSteps, isTargetVisible);
      if (next.length === 0 || sameStepIds(next, stepsRef.current)) return;
      const index = reconcileIndex(stepsRef.current, stepIndexRef.current, next, allSteps);
      stepsRef.current = next;
      stepIndexRef.current = index;
      setSteps(next);
      setStepIndex(index);
    };
    const schedule = () => {
      if (timer === null) timer = setTimeout(recompute, RESOLVE_INTERVAL_MS);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    schedule(); // catches anything that changed between resolving the steps and attaching the observer
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [activeTour, allSteps]);

  const markSeen = useCallback(
    (tourId: string) => {
      setSeenIds((prev) => {
        if (prev.includes(tourId)) return prev;
        const next = [...prev, tourId];
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Ignore storage quota errors
        }
        return next;
      });
    },
    [storageKey],
  );

  const currentRouteTour = useMemo(() => matchTourRoute(pathname, ALL_TOURS), [pathname]);

  const startTour = useCallback(
    (tourId?: string) => {
      const tour = tourId ? ALL_TOURS.find((t) => t.id === tourId) : currentRouteTour;
      if (!tour) return;

      const full = tour.buildSteps(terms);
      const resolved = resolveSteps(full, isTargetVisible);
      if (resolved.length === 0) return;

      setActiveTour(tour);
      setAllSteps(full);
      setSteps(resolved);
      setStepIndex(0);
    },
    [currentRouteTour, terms],
  );

  const stopTour = useCallback(
    (shouldMarkSeen = true) => {
      if (shouldMarkSeen && activeTour) {
        markSeen(activeTour.id);
      }
      setActiveTour(null);
      setAllSteps([]);
      setSteps([]);
      setStepIndex(0);
    },
    [activeTour, markSeen],
  );

  const nextStep = useCallback(() => {
    if (!activeTour) return;
    if (stepIndex >= steps.length - 1) {
      stopTour(true);
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [activeTour, stepIndex, steps.length, stopTour]);

  const prevStep = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const resetSeenTours = useCallback(() => {
    setSeenIds([]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
  }, [storageKey]);

  const value = useMemo<HelpTourContextValue>(
    () => ({
      activeTour,
      steps,
      stepIndex,
      currentStep: activeTour ? (steps[stepIndex] ?? null) : null,
      currentRouteTour,
      hasTourForCurrentRoute: Boolean(currentRouteTour),
      isCurrentRouteSeen: currentRouteTour ? seenIds.includes(currentRouteTour.id) : true,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      resetSeenTours,
    }),
    [activeTour, steps, stepIndex, currentRouteTour, seenIds, startTour, stopTour, nextStep, prevStep, resetSeenTours],
  );

  return <HelpTourContext.Provider value={value}>{children}</HelpTourContext.Provider>;
}

export function useHelpTour(): HelpTourContextValue {
  const ctx = useContext(HelpTourContext);
  if (!ctx) {
    throw new Error('useHelpTour must be used within HelpTourProvider');
  }
  return ctx;
}
