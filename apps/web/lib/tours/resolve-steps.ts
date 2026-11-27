import type { TourStep } from './types';

/**
 * The steps to show right now: steps without a target (overview cards) plus steps whose target is on screen, in the tour's own order.
 * If nothing qualifies (a screen still showing its loading skeleton) fall back to the targetless steps, and finally to the first
 * step as a centred card so the tour always has something to show.
 */
export function resolveSteps(allSteps: readonly TourStep[], isVisible: (target: string) => boolean): TourStep[] {
  const visible = allSteps.filter((step) => !step.target || isVisible(step.target));
  const resolved = visible.length > 0 ? visible : allSteps.filter((step) => !step.target);
  if (resolved.length === 0 && allSteps.length > 0) resolved.push({ ...allSteps[0]!, target: undefined, placement: 'center' });
  return resolved;
}

export function sameStepIds(a: readonly TourStep[], b: readonly TourStep[]): boolean {
  return a.length === b.length && a.every((step, i) => step.id === b[i]!.id);
}

/**
 * Keeps the user's place when the visible steps change while a tour is open. The same step stays current even if steps were inserted
 * before it (so the card does not jump). If the current step is gone, moves to the next step that still exists, else the last one.
 * `order` is the tour's full step list, used to decide what "next" means for a step that has vanished.
 */
export function reconcileIndex(prevSteps: readonly TourStep[], prevIndex: number, nextSteps: readonly TourStep[], order: readonly TourStep[]): number {
  if (nextSteps.length === 0) return 0;
  const current = prevSteps[prevIndex];
  if (!current) return Math.min(Math.max(prevIndex, 0), nextSteps.length - 1);
  const same = nextSteps.findIndex((s) => s.id === current.id);
  if (same >= 0) return same;
  const position = order.findIndex((s) => s.id === current.id);
  if (position >= 0) {
    for (let i = position + 1; i < order.length; i++) {
      const found = nextSteps.findIndex((s) => s.id === order[i]!.id);
      if (found >= 0) return found;
    }
  }
  return nextSteps.length - 1;
}
