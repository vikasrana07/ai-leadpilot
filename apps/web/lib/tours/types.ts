import type { PackTerms } from '@leadpilot/shared-types';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  id: string;
  /** Value of `data-tour="..."` on the target element. Omit for a centered overview card. */
  target?: string;
  title: string;
  description: string;
  placement?: TourPlacement;
}

export interface ScreenTour {
  id: string;
  /** Route pattern, e.g. '/leads' or '/leads/[id]'. */
  route: string;
  title: string;
  buildSteps: (terms: PackTerms) => TourStep[];
}
