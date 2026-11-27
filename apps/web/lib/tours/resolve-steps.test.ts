import { describe, expect, it } from 'vitest';
import { reconcileIndex, resolveSteps, sameStepIds } from './resolve-steps';
import type { TourStep } from './types';

const step = (id: string, target?: string): TourStep => ({ id, title: id, description: id, ...(target ? { target } : {}) });
const overview = step('overview');
const range = step('range', 'range');
const kpis = step('kpis', 'kpis');
const charts = step('charts', 'charts');
const all = [overview, range, kpis, charts];
const ids = (s: readonly TourStep[]) => s.map((x) => x.id);

describe('resolveSteps', () => {
  it('keeps targetless steps and steps whose target is on screen, in the tour order', () => {
    expect(ids(resolveSteps(all, (t) => t === 'kpis' || t === 'range'))).toEqual(['overview', 'range', 'kpis']);
  });
  it('shows everything once every target is on screen', () => {
    expect(ids(resolveSteps(all, () => true))).toEqual(['overview', 'range', 'kpis', 'charts']);
  });
  it('falls back to the targetless steps while the screen is still loading', () => {
    expect(ids(resolveSteps(all, () => false))).toEqual(['overview']);
  });
  it('falls back to the first step as a centred card when no step is targetless', () => {
    const out = resolveSteps([range, kpis], () => false);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'range', target: undefined, placement: 'center' });
  });
  it('returns nothing for a tour with no steps', () => {
    expect(resolveSteps([], () => true)).toEqual([]);
  });
});

describe('sameStepIds', () => {
  it('compares by id and order', () => {
    expect(sameStepIds([overview, range], [overview, range])).toBe(true);
    expect(sameStepIds([overview, range], [range, overview])).toBe(false);
    expect(sameStepIds([overview], [overview, range])).toBe(false);
  });
});

describe('reconcileIndex', () => {
  it('keeps the same step current when steps are inserted before it', () => {
    // user is on "kpis" (index 1 of [overview, kpis]); "range" mounts and is inserted before it
    expect(reconcileIndex([overview, kpis], 1, [overview, range, kpis], all)).toBe(2);
  });
  it('stays on the first step when more steps load after it', () => {
    expect(reconcileIndex([overview], 0, [overview, range, kpis, charts], all)).toBe(0);
  });
  it('moves to the next step that still exists when the current one disappears', () => {
    // on "range" (index 1), it unmounts; "kpis" is the next survivor in the tour order
    expect(reconcileIndex([overview, range, kpis], 1, [overview, kpis, charts], all)).toBe(1);
    // on "kpis", it unmounts and "charts" survives
    expect(reconcileIndex([overview, kpis, charts], 1, [overview, charts], all)).toBe(1);
  });
  it('falls back to the last step when nothing after the current step survives', () => {
    expect(reconcileIndex([overview, range, kpis], 2, [overview, range], all)).toBe(1);
  });
  it('returns 0 for an empty list and clamps a stale index', () => {
    expect(reconcileIndex([overview], 0, [], all)).toBe(0);
    expect(reconcileIndex([], 5, [overview, range], all)).toBe(1);
  });
});
