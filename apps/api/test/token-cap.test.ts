import { describe, expect, it } from 'vitest';
import { evaluateTokenCap } from '../src/ai/token-cap.js';

const monthStart = new Date('2026-11-01T00:00:00Z');
const monthEnd = new Date('2026-12-01T00:00:00Z');
const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const base = { ownCap: 1_000_000, planCap: null as number | null, monthStart, monthEnd, gracePct: 10 };

describe('evaluateTokenCap', () => {
  it('walks the levels as usage grows', () => {
    const lvl = (used: number) => evaluateTokenCap({ ...base, used, now: at(10) }).level;
    expect(lvl(0)).toBe('OK');
    expect(lvl(799_999)).toBe('OK');
    expect(lvl(800_000)).toBe('WARN_80');
    expect(lvl(949_999)).toBe('WARN_80');
    expect(lvl(950_000)).toBe('WARN_95');
    expect(lvl(999_999)).toBe('WARN_95');
    expect(lvl(1_000_000)).toBe('EXCEEDED');
  });

  it('uses the tighter of the own cap and the plan allowance, and says which one binds', () => {
    expect(evaluateTokenCap({ ...base, used: 0, now: at(10), planCap: 500_000 })).toMatchObject({ cap: 500_000, source: 'plan' });
    expect(evaluateTokenCap({ ...base, used: 0, now: at(10), planCap: 5_000_000 })).toMatchObject({ cap: 1_000_000, source: 'own' });
    expect(evaluateTokenCap({ ...base, used: 0, now: at(10), planCap: null })).toMatchObject({ cap: 1_000_000, source: 'own' });
  });

  it('allows a grace band only above the cap, and only up to the grace limit', () => {
    expect(evaluateTokenCap({ ...base, used: 999_999, now: at(10) })).toMatchObject({ exceeded: false, inGrace: false, graceLimit: 1_100_000 });
    expect(evaluateTokenCap({ ...base, used: 1_050_000, now: at(10) })).toMatchObject({ exceeded: true, inGrace: true });
    expect(evaluateTokenCap({ ...base, used: 1_100_000, now: at(10) })).toMatchObject({ exceeded: true, inGrace: false });
    expect(evaluateTokenCap({ ...base, used: 1_050_000, now: at(10), gracePct: 0 })).toMatchObject({ exceeded: true, inGrace: false, graceLimit: 1_000_000 });
  });

  it('forecasts when the cap runs out at the current pace', () => {
    // 400k used by day 11 (10 days elapsed): 40k/day, so 600k more lasts 15 more days, to Nov 26.
    const r = evaluateTokenCap({ ...base, used: 400_000, now: at(11) });
    expect(r.projectedExhaustionAt).toBe('2026-11-26T00:00:00.000Z');
  });

  it('gives no forecast when usage will last the month, is already over, or there is too little data', () => {
    expect(evaluateTokenCap({ ...base, used: 100_000, now: at(16) }).projectedExhaustionAt).toBeNull();
    expect(evaluateTokenCap({ ...base, used: 1_200_000, now: at(16) }).projectedExhaustionAt).toBeNull();
    expect(evaluateTokenCap({ ...base, used: 900, now: at(16) }).projectedExhaustionAt).toBeNull();
    expect(evaluateTokenCap({ ...base, used: 500_000, now: new Date('2026-11-01T06:00:00Z') }).projectedExhaustionAt).toBeNull();
  });

  it('caps the reported percentage at 100 and treats a zero cap as exhausted', () => {
    expect(evaluateTokenCap({ ...base, used: 5_000_000, now: at(10) }).pct).toBe(100);
    expect(evaluateTokenCap({ ...base, used: 0, now: at(10), ownCap: 0 })).toMatchObject({ exceeded: true, level: 'EXCEEDED' });
  });
});
