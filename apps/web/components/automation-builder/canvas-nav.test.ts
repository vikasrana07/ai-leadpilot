import { type AutomationGraph } from '@leadpilot/validation';
import { describe, expect, it } from 'vitest';
import { blankGraph, defaultNode, editorReducer, initialState } from '../../lib/automation-graph-state';
import { layoutGraph } from '../../lib/automation-layout';
import { addSlotFor, neighborOf } from './canvas-nav';

function graph(): AutomationGraph {
  let s = initialState(blankGraph({ trigger: 't', action: 'a1' }));
  s = editorReducer(s, { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('branch', 'b') });
  s = editorReducer(s, { type: 'insert', parentId: 'b', slot: 'no', node: defaultNode('wait', 'w') });
  return s.graph;
}

describe('canvas keyboard navigation', () => {
  const g = graph(); const p = layoutGraph(g);
  it('Down follows the If side first, Up goes back to the parent', () => {
    expect(neighborOf(g, p, 't', 'ArrowDown')).toBe('b');
    expect(neighborOf(g, p, 'b', 'ArrowDown')).toBe('a1');
    expect(neighborOf(g, p, 'a1', 'ArrowUp')).toBe('b');
    expect(neighborOf(g, p, 't', 'ArrowUp')).toBeNull();
    expect(neighborOf(g, p, 'w', 'ArrowDown')).toBeNull();
  });
  it('Left and Right move along the same row and stop at the ends', () => {
    expect(neighborOf(g, p, 'a1', 'ArrowRight')).toBe('w'); expect(neighborOf(g, p, 'w', 'ArrowLeft')).toBe('a1');
    expect(neighborOf(g, p, 'a1', 'ArrowLeft')).toBeNull(); expect(neighborOf(g, p, 'w', 'ArrowRight')).toBeNull();
  });
});

describe('where a new step goes', () => {
  const g = graph();
  it('after the selected step, the first open side of a condition, or after the trigger', () => {
    expect(addSlotFor(g, 'a1')).toEqual({ parent: 'a1', slot: 'next' });
    expect(addSlotFor(g, null)).toEqual({ parent: 't', slot: 'next' });
    expect(addSlotFor(g, 'missing')).toEqual({ parent: 't', slot: 'next' });
    const open = editorReducer(initialState(g), { type: 'connect', from: 'b', slot: 'no', to: null }).graph;
    expect(addSlotFor(open, 'b')).toEqual({ parent: 'b', slot: 'no' });
    expect(addSlotFor(g, 'b')).toEqual({ parent: 'b', slot: 'yes' });
  });
});
