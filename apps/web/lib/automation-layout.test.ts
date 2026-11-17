import { validateGraph, graphErrors, type AutomationGraph, type GraphNode } from '@leadpilot/validation';
import { describe, expect, it } from 'vitest';
import { blankGraph, defaultNode, editorReducer, initialState } from './automation-graph-state';
import { layoutGraph, NODE_H, NODE_W, tidyGraph } from './automation-layout';

const action = (id: string): GraphNode => ({ id, type: 'action', data: { type: 'notify', target: 'managers', title: id } });
function branching(): AutomationGraph {
  let s = initialState(blankGraph({ trigger: 't', action: 'a1' }));
  s = editorReducer(s, { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('branch', 'b') });
  s = editorReducer(s, { type: 'insert', parentId: 'b', slot: 'no', node: defaultNode('wait', 'w') });
  s = editorReducer(s, { type: 'insert', parentId: 'w', slot: 'next', node: action('late') });
  return s.graph;
}
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;

describe('canvas layout', () => {
  it('puts the trigger on the top row and every step on a row below the step that leads to it', () => {
    const g = branching(); const p = layoutGraph(g);
    expect(p.t?.y).toBe(0);
    for (const e of g.edges) expect((p[e.to] as { y: number }).y, `${e.from}->${e.to}`).toBeGreaterThan((p[e.from] as { y: number }).y);
  });

  it('places If to the left of Otherwise and never overlaps two steps', () => {
    const g = branching(); const p = layoutGraph(g);
    expect((p.a1 as { x: number }).x).toBeLessThan((p.w as { x: number }).x);
    const ids = Object.keys(p);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(overlaps(p[ids[i] as string] as { x: number; y: number }, p[ids[j] as string] as { x: number; y: number }), `${ids[i]} vs ${ids[j]}`).toBe(false);
  });

  it('is deterministic and gives a rejoining step the deepest row', () => {
    const g = branching();
    expect(layoutGraph(g)).toEqual(layoutGraph(g));
    // join: a1 (If side) and late (Otherwise side) both continue to "end-note"
    const joined: AutomationGraph = { ...g, nodes: [...g.nodes, action('join')], edges: [...g.edges, { id: 'j1', from: 'a1', to: 'join', label: 'next' }, { id: 'j2', from: 'late', to: 'join', label: 'next' }] };
    const p = layoutGraph(joined);
    expect((p.join as { y: number }).y).toBeGreaterThan((p.late as { y: number }).y);
    expect(graphErrors(validateGraph(joined))).toEqual([]);
  });

  it('keeps unconnected steps visible in a row of their own and survives an empty or malformed graph', () => {
    const g = branching(); const stray = { ...g, nodes: [...g.nodes, action('lost')] };
    const p = layoutGraph(stray); expect(Object.keys(p)).toContain('lost');
    expect((p.lost as { y: number }).y).toBeGreaterThan(Math.max(...g.nodes.map((n) => (p[n.id] as { y: number }).y)));
    expect(layoutGraph({ v: 1, nodes: [], edges: [] })).toEqual({});
    const loop: AutomationGraph = { v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'lead.created' } }, action('x'), action('y')], edges: [{ id: 'e1', from: 't', to: 'x', label: 'next' }, { id: 'e2', from: 'x', to: 'y', label: 'next' }, { id: 'e3', from: 'y', to: 'x', label: 'next' }] };
    expect(Object.keys(layoutGraph(loop)).sort()).toEqual(['t', 'x', 'y']);
  });

  it('tidyGraph keeps the graph valid and gives every step a position', () => {
    const t = tidyGraph(branching()); expect(t.nodes.every((n) => n.pos)).toBe(true); expect(graphErrors(validateGraph(t))).toEqual([]);
  });
});
