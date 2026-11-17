import { packForIndustry, packTerms } from '@leadpilot/shared-types';
import { describe, expect, it } from 'vitest';
import { applyTerms } from './terms-text';

const t = (id: string) => packTerms(packForIndustry(id));
describe('applyTerms', () => {
  it('leaves real estate and general copy untouched', () => {
    for (const id of ['real_estate', 'something_else']) {
      for (const text of ['Leads per day', 'Lead acquisition', "How far this period's leads got", 'Where leads come from', 'Leads reaching each stage']) expect(applyTerms(text, t(id))).toBe(text);
    }
  });
  it('re-words visit with the right article and plural', () => {
    expect(applyTerms('Sends a confirmation as soon as a visit is booked.', t('home_services'))).toBe('Sends a confirmation as soon as an inspection is booked.');
    expect(applyTerms('A reminder 24 hours before the visit, and visits', t('coaching'))).toBe('A reminder 24 hours before the demo class, and demo classes');
    expect(applyTerms('A visit is booked', t('healthcare'))).toBe('A consultation is booked');
    expect(applyTerms('A visit is booked', t('home_services'))).toBe('An inspection is booked');
    for (const text of ['as soon as a visit is booked', 'before the visit', 'A visit is booked']) expect(applyTerms(text, t('real_estate'))).toBe(text);
  });
  it('re-words whole words for other industries and does not touch longer words', () => {
    expect(applyTerms('Leads per day', t('coaching'))).toBe('Enquiries per day');
    expect(applyTerms('Lead acquisition', t('healthcare'))).toBe('Enquiry acquisition');
    expect(applyTerms('Where leads come from and how many convert.', t('home_services'))).toBe('Where customers come from and how many convert.');
    expect(applyTerms('Leadership, misleading, leader', t('coaching'))).toBe('Leadership, misleading, leader');
  });
});

describe('applyTerms: capitalised visit words (report column labels)', () => {
  it('re-words "Visits completed" per industry and leaves real estate alone', () => {
    expect(applyTerms('Visits completed', t('real_estate'))).toBe('Visits completed');
    expect(applyTerms('Visits completed', t('coaching'))).toBe('Demo classes completed');
    expect(applyTerms('Visit', t('healthcare'))).toBe('Consultation');
    expect(applyTerms('Visits completed', t('home_services'))).toBe('Inspections completed');
  });
});
