import { packForIndustry, packTerms } from '@leadpilot/shared-types';
import { describe, expect, it } from 'vitest';
import { ALL_TOURS, matchTourRoute } from './index';

const EXPECTED_APP_ROUTES = [
  '/dashboard',
  '/leads',
  '/leads/lead-123',
  '/pipeline',
  '/inbox',
  '/emails',
  '/campaigns',
  '/campaigns/camp-456',
  '/properties',
  '/ai-assistant',
  '/knowledge',
  '/appointments',
  '/tasks',
  '/automations',
  '/automations/new',
  '/automations/auto-789/edit',
  '/reports',
  '/team',
  '/roles',
  '/integrations',
  '/api-keys',
  '/webhooks',
  '/billing',
  '/usage',
  '/audit',
  '/security',
  '/settings',
  '/onboarding',
];

describe('ALL_TOURS & matchTourRoute', () => {
  it('registers unique tour IDs and routes for all 28 workspace screens', () => {
    const ids = ALL_TOURS.map((t) => t.id);
    const routes = ALL_TOURS.map((t) => t.route);
    expect(new Set(ids).size).toBe(ALL_TOURS.length);
    expect(new Set(routes).size).toBe(ALL_TOURS.length);
    expect(ALL_TOURS.length).toBe(28);
  });

  it.each(EXPECTED_APP_ROUTES)('matches %s to a ScreenTour with valid steps', (pathname) => {
    const tour = matchTourRoute(pathname, ALL_TOURS);
    expect(tour, `Expected a tour for ${pathname}`).toBeDefined();

    const terms = packTerms(packForIndustry('real_estate'));
    const steps = tour!.buildSteps(terms);
    expect(steps.length).toBeGreaterThan(0);

    const stepIds = steps.map((s) => s.id);
    expect(new Set(stepIds).size).toBe(steps.length);
    for (const step of steps) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('ignores query strings and trailing slashes when matching routes', () => {
    expect(matchTourRoute('/leads/?stageId=123', ALL_TOURS)?.id).toBe('leads');
    expect(matchTourRoute('/inbox?c=conv-1', ALL_TOURS)?.id).toBe('inbox');
    expect(matchTourRoute('/automations/abc/edit/?runId=1', ALL_TOURS)?.id).toBe('automations-edit');
  });

  it('returns undefined for auth and platform routes', () => {
    expect(matchTourRoute('/login', ALL_TOURS)).toBeUndefined();
    expect(matchTourRoute('/platform/tenants', ALL_TOURS)).toBeUndefined();
    expect(matchTourRoute('/p/widget-key', ALL_TOURS)).toBeUndefined();
  });

  it('adapts tour copy to the active industry pack terminology', () => {
    const leadsTour = matchTourRoute('/leads', ALL_TOURS)!;
    const realEstateTerms = packTerms(packForIndustry('real_estate'));
    const homeServicesTerms = packTerms(packForIndustry('home_services'));
    const realEstate = leadsTour.buildSteps(realEstateTerms);
    const homeServices = leadsTour.buildSteps(homeServicesTerms);

    expect(homeServicesTerms.lead).toBe('customer');
    expect(realEstate.some((s) => s.title.toLowerCase().includes(realEstateTerms.lead))).toBe(true);
    expect(homeServices.some((s) => s.title.toLowerCase().includes(homeServicesTerms.lead))).toBe(true);
  });
});
