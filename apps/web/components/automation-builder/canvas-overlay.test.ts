import { type AutomationGraph } from '@leadpilot/validation';
import { describe, expect, it } from 'vitest';
import { blankGraph, defaultNode, editorReducer, initialState } from '../../lib/automation-graph-state';
import { marksFromDryRun, marksFromRun, missingFromGraph, takenEdges } from './canvas-overlay';

function graph(): AutomationGraph {
  let s = initialState(blankGraph({ trigger: 't', action: 'a1' }));
  s = editorReducer(s, { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('branch', 'b') });
  s = editorReducer(s, { type: 'insert', parentId: 'b', slot: 'no', node: defaultNode('wait', 'w') });
  s = editorReducer(s, { type: 'insert', parentId: 'w', slot: 'next', node: { id: 'late', type: 'action', data: { type: 'notify', target: 'managers', title: 'late' } } });
  return s.graph;
}
const edge = (g: AutomationGraph, from: string, label: string) => g.edges.find((e) => e.from === from && e.label === label)?.id as string;

describe('canvas overlay', () => {
  it('a dry run that takes the If side marks that side only', () => {
    const g = graph();
    const marks = marksFromDryRun(g, [{ nodeId: 'b', type: 'branch', outcome: 'yes', conditions: [{ text: 'Temperature is HOT', pass: true }] }, { nodeId: 'a1', type: 'notify', outcome: 'would_run' }]);
    expect(marks.get('t')?.state).toBe('start'); expect(marks.get('b')?.text).toMatch(/If path/); expect(marks.has('w')).toBe(false);
    const taken = takenEdges(g, marks);
    expect(taken.has(edge(g, 't', 'next'))).toBe(true); expect(taken.has(edge(g, 'b', 'yes'))).toBe(true);
    expect(taken.has(edge(g, 'b', 'no'))).toBe(false); expect(taken.has(edge(g, 'w', 'next'))).toBe(false);
  });

  it('the Otherwise side with a simulated wait shows the wait in words', () => {
    const g = graph();
    const marks = marksFromDryRun(g, [{ nodeId: 'b', type: 'branch', outcome: 'no' }, { nodeId: 'w', type: 'wait', outcome: 'would_wait', wouldWaitMinutes: 1440 }, { nodeId: 'late', type: 'notify', outcome: 'would_run' }]);
    expect(marks.get('w')?.text).toBe('Would wait 1 day'); expect(marks.get('w')?.state).toBe('wait_sim');
    const taken = takenEdges(g, marks);
    expect(taken.has(edge(g, 'b', 'no'))).toBe(true); expect(taken.has(edge(g, 'b', 'yes'))).toBe(false); expect(taken.has(edge(g, 'w', 'next'))).toBe(true);
  });

  it('a real run: ran, skipped, failed and waiting are told apart in words, and the trigger counts as reached', () => {
    const g = graph();
    const marks = marksFromRun(g, [
      { i: 0, nodeId: 'b', type: 'branch', status: 'done', branch: 'no' },
      { i: 1, nodeId: 'w', type: 'wait', status: 'waiting', detail: 'Waiting until later' },
    ]);
    expect(marks.get('t')?.state).toBe('start'); expect(marks.get('b')?.state).toBe('no'); expect(marks.get('w')?.state).toBe('waiting');
    const failed = marksFromRun(g, [{ i: 0, nodeId: 'a1', type: 'notify', status: 'failed', detail: 'boom' }, { i: 1, nodeId: 'a1', type: 'notify', status: 'skipped', detail: 'no phone' }]);
    expect(failed.get('a1')?.state).toBe('skipped'); expect(failed.get('a1')?.detail).toBe('no phone');
  });

  it('the stored row of a test (status "preview") reads as "would", not as something that happened', () => {
    const g = graph();
    const marks = marksFromRun(g, [{ i: 0, nodeId: 'b', type: 'branch', status: 'preview', branch: 'no' }, { i: 1, nodeId: 'w', type: 'wait', status: 'preview' }, { i: 2, nodeId: 'late', type: 'notify', status: 'preview' }]);
    expect(marks.get('w')?.text).toBe('Would wait'); expect(marks.get('late')?.text).toBe('Would run'); expect(marks.get('b')?.state).toBe('no');
  });

  it('a run with only gate steps (no node ids) marks nothing, and edited-away steps are counted', () => {
    const g = graph();
    expect(marksFromRun(g, [{ i: -1, type: 'gate', status: 'skipped', detail: 'cooldown' }]).size).toBe(0);
    expect(missingFromGraph(g, [{ i: 0, nodeId: 'gone', type: 'notify', status: 'done' }, { i: 1, nodeId: 'gone', type: 'notify', status: 'done' }, { i: 2, nodeId: 'a1', type: 'notify', status: 'done' }])).toBe(1);
  });
});
