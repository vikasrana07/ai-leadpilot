import { describe, expect, it } from 'vitest';
import { parseMetaLeadPayload } from '../src/capture/meta-lead-ads.service.js';

describe('Meta Lead Ads Ingestion Parser', () => {
  it('parses direct structured lead payload', () => {
    const raw = {
      full_name: 'Pooja Verma',
      phone_number: '+919876543210',
      email: 'pooja.verma@example.test',
      city: 'Pune',
      requirements: 'Looking for 3 BHK in Baner under 1.5 Cr',
      form_id: 'form-12345',
      ad_id: 'ad-67890',
      leadgen_id: 'leadgen-99999',
    };

    const parsed = parseMetaLeadPayload(raw);
    expect(parsed.name).toBe('Pooja Verma');
    expect(parsed.phone).toBe('+919876543210');
    expect(parsed.email).toBe('pooja.verma@example.test');
    expect(parsed.location).toBe('Pune');
    expect(parsed.requirements).toBe('Looking for 3 BHK in Baner under 1.5 Cr');
    expect(parsed.formId).toBe('form-12345');
    expect(parsed.adId).toBe('ad-67890');
    expect(parsed.leadgenId).toBe('leadgen-99999');
  });

  it('parses Meta Graph API field_data array format', () => {
    const raw = {
      form_id: 'form-meta-987',
      leadgen_id: 'lead-meta-456',
      field_data: [
        { name: 'full_name', values: ['Aakash Mehta'] },
        { name: 'phone_number', values: ['+919812345678'] },
        { name: 'email', values: ['aakash@example.test'] },
        { name: 'city', values: ['Mumbai'] },
        { name: 'preferred_bhk', values: ['2 BHK'] },
        { name: 'budget_range', values: ['80L - 1Cr'] },
      ],
    };

    const parsed = parseMetaLeadPayload(raw);
    expect(parsed.name).toBe('Aakash Mehta');
    expect(parsed.phone).toBe('+919812345678');
    expect(parsed.email).toBe('aakash@example.test');
    expect(parsed.location).toBe('Mumbai');
    expect(parsed.requirements).toContain('preferred_bhk: 2 BHK');
    expect(parsed.requirements).toContain('budget_range: 80L - 1Cr');
    expect(parsed.formId).toBe('form-meta-987');
  });

  it('parses Meta Webhook entry changes notification format', () => {
    const raw = {
      object: 'page',
      entry: [
        {
          id: 'page-100200300',
          time: 1732450000,
          changes: [
            {
              field: 'leadgen',
              value: {
                ad_id: 'ad-999',
                form_id: 'form-888',
                leadgen_id: 'lead-777',
                page_id: 'page-100200300',
              },
            },
          ],
        },
      ],
    };

    const parsed = parseMetaLeadPayload(raw);
    expect(parsed.leadgenId).toBe('lead-777');
    expect(parsed.formId).toBe('form-888');
    expect(parsed.adId).toBe('ad-999');
  });
});
