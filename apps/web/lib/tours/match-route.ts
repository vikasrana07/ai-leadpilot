import type { ScreenTour } from './types';

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '/';
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

/**
 * Matches a concrete Next.js `pathname` (e.g. `/leads/123` or `/automations/abc/edit`)
 * against registered `ScreenTour` route patterns.
 */
export function matchTourRoute(pathname: string, tours: readonly ScreenTour[]): ScreenTour | undefined {
  const normalized = normalizePathname(pathname);

  const exact = tours.find((tour) => tour.route === normalized);
  if (exact) return exact;

  const segments = normalized.split('/').filter(Boolean);
  return tours.find((tour) => {
    const patternSegments = tour.route.split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) return false;
    return patternSegments.every((seg, i) => {
      if (seg.startsWith('[') && seg.endsWith(']')) {
        return Boolean(segments[i]);
      }
      return seg === segments[i];
    });
  });
}
