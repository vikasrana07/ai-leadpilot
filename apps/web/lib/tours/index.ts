export { matchTourRoute } from './match-route';
export { reconcileIndex, resolveSteps, sameStepIds } from './resolve-steps';
export type { ScreenTour, TourPlacement, TourStep } from './types';

import { AI_AND_AUTOMATION_TOURS } from './screens/ai-and-automation';
import { CRM_AND_MESSAGING_TOURS } from './screens/crm-and-messaging';
import { WORKSPACE_ADMIN_TOURS } from './screens/workspace-admin';
import type { ScreenTour } from './types';

export const ALL_TOURS: readonly ScreenTour[] = [
  ...CRM_AND_MESSAGING_TOURS,
  ...AI_AND_AUTOMATION_TOURS,
  ...WORKSPACE_ADMIN_TOURS,
];
