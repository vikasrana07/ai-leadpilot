'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/pack';
import { ALL_TOURS, matchTourRoute } from '@/lib/tours';
import type { ScreenTour, TourStep } from '@/lib/tours/types';

const STORAGE_PREFIX = 'lp:tour:seen:';

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
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setSeenIds(readSeenIds(storageKey));
  }, [storageKey]);

  // Close an active tour when navigating to another screen.
  useEffect(() => {
    setActiveTour(null);
    setSteps([]);
    setStepIndex(0);
  }, [pathname]);

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

      const allSteps = tour.buildSteps(terms);
      const visibleSteps = allSteps.filter((step) => !step.target || isTargetVisible(step.target));
      const resolved = visibleSteps.length > 0 ? visibleSteps : allSteps.filter((step) => !step.target);
      if (resolved.length === 0 && allSteps.length > 0) {
        // Fallback to first step as centered card if no DOM targets are mounted yet (e.g. loading/empty state)
        resolved.push({ ...allSteps[0]!, target: undefined, placement: 'center' });
      }
      if (resolved.length === 0) return;

      setActiveTour(tour);
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
