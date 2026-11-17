import { packForIndustry, packTerms, pluralise, withArticle } from '@leadpilot/shared-types';
import { describe, expect, it } from 'vitest';

describe('packTerms', () => {
  it('pluralises and adds articles sensibly', () => {
    expect(pluralise('enquiry')).toBe('enquiries'); expect(pluralise('lead')).toBe('leads'); expect(pluralise('class')).toBe('classes'); expect(pluralise('day')).toBe('days');
    expect(withArticle('enquiry')).toBe('an enquiry'); expect(withArticle('lead')).toBe('a lead');
  });
  it('keeps real estate wording exactly as it was', () => {
    const t = packTerms(packForIndustry('real_estate'));
    expect([t.Lead, t.Leads, t.lead, t.leads, t.aLead]).toEqual(['Lead', 'Leads', 'lead', 'leads', 'a lead']);
    expect([t.Visit, t.visit, t.visits, t.Visits, t.aVisit]).toEqual(['Site visit', 'site visit', 'site visits', 'Site visits', 'a site visit']);
    expect(t.event).toBe('visit'); expect(t.summary).toEqual({ lead: 'lead', appointment: 'appointment' });
  });
  it('uses each industry pack\'s own nouns', () => {
    const c = packTerms(packForIndustry('coaching')); expect([c.Lead, c.Leads, c.aLead, c.event, c.aVisit]).toEqual(['Enquiry', 'Enquiries', 'an enquiry', 'demo class', 'a demo class']);
    expect(c.summary).toEqual({ lead: 'enquiry', appointment: 'demo class' });
    const h = packTerms(packForIndustry('healthcare')); expect([h.Leads, h.event, h.Visits]).toEqual(['Enquiries', 'consultation', 'Consultations']);
    const s = packTerms(packForIndustry('home_services')); expect([s.Lead, s.Leads, s.event, s.visits]).toEqual(['Customer', 'Customers', 'inspection', 'inspections']);
    const g = packTerms(packForIndustry('something_else')); expect([g.Leads, g.event, g.summary.appointment]).toEqual(['Leads', 'meeting', 'appointment']);
  });
});
