import { describe, expect, it } from 'vitest';
import { computeDealPulse } from '../src/conversations/deal-pulse.js';

describe('computeDealPulse (unit)', () => {
  const now = new Date('2026-11-27T12:00:00.000Z');
  const lead = { name: 'Priya Sharma', temperature: 'HOT', score: 85, propertyType: '3BHK', location: 'Bandra' };

  it('marks conversation AT_RISK when outbound message is unanswered >= 24h', () => {
    const res = computeDealPulse(
      [
        { direction: 'INBOUND', body: 'Please share 3BHK details and floor plan.', createdAt: new Date('2026-11-26T09:00:00.000Z') },
        { direction: 'OUTBOUND', body: 'Shared the brochure and pricing.', createdAt: new Date('2026-11-26T10:00:00.000Z') },
      ],
      lead,
      now,
    );
    expect(res.status).toBe('AT_RISK');
    expect(res.reasons.length).toBeGreaterThanOrEqual(1);
    expect(res.patternInterrupt).toContain('Priya');
    expect(res.patternInterrupt).toContain('3BHK');
  });

  it('marks conversation COOLING when customer replies shrink significantly', () => {
    const res = computeDealPulse(
      [
        { direction: 'INBOUND', body: 'Hi, I am looking for a spacious 3BHK apartment in Bandra with parking.', createdAt: new Date('2026-11-27T10:00:00.000Z') },
        { direction: 'OUTBOUND', body: 'We have great options available!', createdAt: new Date('2026-11-27T10:05:00.000Z') },
        { direction: 'INBOUND', body: 'ok thanks', createdAt: new Date('2026-11-27T11:30:00.000Z') },
      ],
      lead,
      now,
    );
    expect(res.status).toBe('COOLING');
    expect(res.reasons).toContain('Customer replies are getting shorter');
  });

  it('marks active conversation HEALTHY', () => {
    const res = computeDealPulse(
      [
        { direction: 'OUTBOUND', body: 'Hi Priya, are you free at 4 PM?', createdAt: new Date('2026-11-27T11:00:00.000Z') },
        { direction: 'INBOUND', body: 'Yes, 4 PM works great for me, see you then!', createdAt: new Date('2026-11-27T11:30:00.000Z') },
      ],
      lead,
      now,
    );
    expect(res.status).toBe('HEALTHY');
  });
});
