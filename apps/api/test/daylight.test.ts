import { describe, expect, it } from 'vitest';
import { isWithinDaylightHours, msUntilNextDaylight } from '../src/campaigns/daylight.js';

describe('Campaign Daylight Sending Window', () => {
  it('returns 0 delay during daylight hours (e.g. 2:30 PM)', () => {
    // 2:30 PM Kolkata time (09:00 UTC)
    const afternoon = new Date('2026-11-24T09:00:00Z');
    expect(isWithinDaylightHours('Asia/Kolkata', afternoon)).toBe(true);
    expect(msUntilNextDaylight('Asia/Kolkata', afternoon)).toBe(0);
  });

  it('delays dispatch when called at 11:00 PM until 09:00 AM next day', () => {
    // 11:30 PM Kolkata time (18:00 UTC)
    const night = new Date('2026-11-24T18:00:00Z');
    expect(isWithinDaylightHours('Asia/Kolkata', night)).toBe(false);
    const delay = msUntilNextDaylight('Asia/Kolkata', night);
    expect(delay).toBeGreaterThan(0);
    // Between 11:30 PM and 9:00 AM is ~9.5 hours (34,200,000 ms)
    expect(delay).toBeCloseTo(9.5 * 60 * 60 * 1000, -6);
  });

  it('delays dispatch when called at 4:00 AM until 09:00 AM today', () => {
    // 4:00 AM Kolkata time (22:30 UTC previous day)
    const earlyMorning = new Date('2026-11-23T22:30:00Z');
    expect(isWithinDaylightHours('Asia/Kolkata', earlyMorning)).toBe(false);
    const delay = msUntilNextDaylight('Asia/Kolkata', earlyMorning);
    expect(delay).toBeGreaterThan(0);
    // Exactly 5 hours (18,000,000 ms)
    expect(delay).toBeCloseTo(5 * 60 * 60 * 1000, -6);
  });

  it('handles custom timezones safely (e.g. America/New_York)', () => {
    // 12:00 PM EST (17:00 UTC)
    const middayNy = new Date('2026-11-24T17:00:00Z');
    expect(isWithinDaylightHours('America/New_York', middayNy)).toBe(true);
    expect(msUntilNextDaylight('America/New_York', middayNy)).toBe(0);
  });

  it('gracefully falls back if an invalid timezone string is passed', () => {
    const now = new Date();
    expect(isWithinDaylightHours('Invalid/Timezone_Name', now)).toBe(true);
    expect(msUntilNextDaylight('Invalid/Timezone_Name', now)).toBe(0);
  });
});
