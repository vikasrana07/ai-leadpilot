import { validateGraph, graphErrors, type AutomationGraph, type GraphNode } from '@leadpilot/validation';
import { describe, expect, it } from 'vitest';
import { blankGraph, defaultNode, editorReducer, HISTORY_LIMIT, initialState, isDirty, nodeById, slotEdge, validTargets, type EditorAction, type EditorState } from './automation-graph-state';

const run = (s: EditorState, ...as: EditorAction[]) => as.reduce(editorReducer, s);
const start = () => initialState(blankGraph({ trigger: 't', action: 'a1' }));
const ok = (g: AutomationGraph) => expect(graphErrors(validateGraph(g)), JSON.stringify(graphErrors(validateGraph(g)))).toEqual([]);
const action = (id: string, title = id): GraphNode => ({ id, type: 'action', data: { type: 'notify', target: 'managers', title } });
const chain = (g: AutomationGraph) => { const out: string[] = []; let cur = 't'; for (;;) { const e = g.edges.find((x) => x.from === cur && (x.label === 'next' || x.label === 'timeout')); if (!e) break; out.push(e.to); cur = e.to; } return out; };

describe('editor reducer', () => {
  it('starts valid and clean; any change makes it dirty and saving makes it clean again', () => {
    const s = start(); ok(s.graph); expect(isDirty(s)).toBe(false);
    const s2 = run(s, { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') });
    expect(isDirty(s2)).toBe(true); expect(isDirty(run(s2, { type: 'markSaved' }))).toBe(false);
  });

  it('inserts between two steps and keeps the old child attached', () => {
    const s = run(start(), { type: 'insert', parentId: 't', slot: 'next', node: action('mid') });
    expect(chain(s.graph)).toEqual(['mid', 'a1']); ok(s.graph);
    expect(s.focus).toBe('mid'); expect(s.selected).toBe('mid'); expect(s.notice).toMatch(/^Added step/);
  });

  it('inserting a branch keeps the old child on the "If" side and leaves "Otherwise" open', () => {
    const s = run(start(), { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('branch', 'b') });
    expect(slotEdge(s.graph, 'b', 'yes')?.to).toBe('a1'); expect(slotEdge(s.graph, 'b', 'no')).toBeUndefined();
    expect(graphErrors(validateGraph(s.graph))).toEqual([]); // an open side is only a warning
    const s2 = run(s, { type: 'insert', parentId: 'b', slot: 'no', node: action('other') });
    expect(slotEdge(s2.graph, 'b', 'no')?.to).toBe('other'); ok(s2.graph);
  });

  it('a wait can get a "replied" path, and its continuation stays on the timeout side', () => {
    let s = run(start(), { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('wait', 'w') });
    s = run(s, { type: 'insert', parentId: 'w', slot: 'replied', node: action('thanks') });
    expect(slotEdge(s.graph, 'w', 'replied')?.to).toBe('thanks'); expect(slotEdge(s.graph, 'w', 'next')?.to).toBe('a1'); ok(s.graph);
  });

  it('deleting a middle step reconnects its parent to its child', () => {
    const s0 = run(start(), { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') }, { type: 'insert', parentId: 'a2', slot: 'next', node: action('a3') });
    expect(chain(s0.graph)).toEqual(['a1', 'a2', 'a3']);
    const s = run(s0, { type: 'remove', id: 'a2' });
    expect(chain(s.graph)).toEqual(['a1', 'a3']); ok(s.graph); expect(s.focus).toBe('a1');
  });

  it('deleting a branch keeps the "If" path and drops the "Otherwise" subtree', () => {
    let s = run(start(), { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('branch', 'b') }, { type: 'insert', parentId: 'b', slot: 'no', node: action('other') });
    s = run(s, { type: 'remove', id: 'b' });
    expect(chain(s.graph)).toEqual(['a1']); expect(nodeById(s.graph, 'other')).toBeUndefined(); expect(s.notice).toMatch(/only it led to/); ok(s.graph);
  });

  it('refuses to delete the trigger', () => {
    const s = run(start(), { type: 'remove', id: 't' });
    expect(nodeById(s.graph, 't')).toBeTruthy(); expect(s.notice).toMatch(/trigger/);
  });

  it('moves a step down and up, and reports when it cannot', () => {
    const s0 = run(start(), { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') }, { type: 'insert', parentId: 'a2', slot: 'next', node: action('a3') });
    const down = run(s0, { type: 'move', id: 'a1', dir: 'down' });
    expect(chain(down.graph)).toEqual(['a2', 'a1', 'a3']); ok(down.graph);
    const up = run(down, { type: 'move', id: 'a3', dir: 'up' });
    expect(chain(up.graph)).toEqual(['a2', 'a3', 'a1']); ok(up.graph);
    const last = run(up, { type: 'move', id: 'a1', dir: 'down' });
    expect(chain(last.graph)).toEqual(['a2', 'a3', 'a1']); expect(last.notice).toMatch(/already last/);
    const first = run(s0, { type: 'move', id: 'a1', dir: 'up' });
    expect(chain(first.graph)).toEqual(['a1', 'a2', 'a3']); expect(first.notice).toMatch(/already first|cannot be moved/);
  });

  it('connect: rejects loops, offers only safe targets, and removes steps that nothing reaches any more', () => {
    let s = run(start(), { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') }, { type: 'insert', parentId: 'a2', slot: 'next', node: action('a3') });
    // a3 -> a1 would loop
    const loop = run(s, { type: 'connect', from: 'a3', slot: 'next', to: 'a1' });
    expect(slotEdge(loop.graph, 'a3', 'next')).toBeUndefined(); expect(loop.notice).toMatch(/loop/);
    expect(validTargets(s.graph, 'a3', 'next').map((n) => n.id)).toEqual([]);
    expect(validTargets(s.graph, 'a1', 'next').map((n) => n.id).sort()).toEqual(['a2', 'a3']);
    // skip a2: a1 -> a3 orphans a2, which is removed (and can be undone)
    s = run(s, { type: 'connect', from: 'a1', slot: 'next', to: 'a3' });
    expect(chain(s.graph)).toEqual(['a1', 'a3']); expect(nodeById(s.graph, 'a2')).toBeUndefined(); expect(s.notice).toMatch(/removed/); ok(s.graph);
    expect(chain(run(s, { type: 'undo' }).graph)).toEqual(['a1', 'a2', 'a3']);
    // never into the trigger
    expect(run(s, { type: 'connect', from: 'a3', slot: 'next', to: 't' }).notice).toMatch(/cannot be connected/);
  });

  it('two paths can join the same step (a branch whose sides meet)', () => {
    let s = run(start(), { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('branch', 'b') });
    s = run(s, { type: 'connect', from: 'b', slot: 'no', to: 'a1' });
    expect(slotEdge(s.graph, 'b', 'yes')?.to).toBe('a1'); expect(slotEdge(s.graph, 'b', 'no')?.to).toBe('a1'); ok(s.graph);
    const del = run(s, { type: 'remove', id: 'a1' });
    expect(nodeById(del.graph, 'a1')).toBeUndefined(); expect(del.graph.edges.some((e) => e.to === 'a1')).toBe(false);
  });

  it('merges consecutive edits of one step into a single undo step', () => {
    const s0 = start();
    const set = (title: string): EditorAction => ({ type: 'update', id: 'a1', data: { type: 'notify', target: 'managers', title } });
    const s = run(s0, set('N'), set('Ne'), set('New'));
    expect(s.past).toHaveLength(1); expect((nodeById(s.graph, 'a1') as Extract<GraphNode, { type: 'action' }>).data).toMatchObject({ title: 'New' });
    const undone = run(s, { type: 'undo' });
    expect(canonicalTitle(undone)).toBe('New lead: {{lead.name}}'); expect(isDirty(undone)).toBe(false);
    expect(canonicalTitle(run(undone, { type: 'redo' }))).toBe('New');
  });

  it('keeps at most 50 undo steps and a new change clears redo', () => {
    let s = start();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) s = run(s, { type: 'update', id: 'a1', data: { type: 'notify', target: 'managers', title: `t${i}` } }, { type: 'select', id: null });
    expect(s.past.length).toBe(HISTORY_LIMIT);
    const u = run(s, { type: 'undo' }); expect(u.future).toHaveLength(1);
    expect(run(u, { type: 'insert', parentId: 'a1', slot: 'next', node: action('z') }).future).toHaveLength(0);
  });

  it('announces structural changes and refusals, but settings edits only update the text quietly', () => {
    const s0 = start();
    const typed = run(s0, { type: 'update', id: 'a1', data: { type: 'notify', target: 'managers', title: 'x' } });
    expect(typed.noticeSeq).toBe(s0.noticeSeq);
    const added = run(typed, { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') });
    expect(added.noticeSeq).toBe(typed.noticeSeq + 1); expect(added.noticeIsError).toBe(false);
    const refused = run(added, { type: 'connect', from: 'a2', slot: 'next', to: 'a1' });
    expect(refused.noticeSeq).toBe(added.noticeSeq + 1); expect(refused.noticeIsError).toBe(true);
    expect(run(refused, { type: 'select', id: 'a1' }).noticeSeq).toBe(refused.noticeSeq); // selecting says nothing
  });

  it('replace swaps in a restored draft as an undoable, still-unsaved change', () => {
    const s0 = start();
    const draft: AutomationGraph = { ...s0.graph, nodes: [...s0.graph.nodes, action('a2')], edges: [...s0.graph.edges, { id: 'e-a1-next', from: 'a1', to: 'a2', label: 'next' }] };
    const s = run(s0, { type: 'replace', graph: draft });
    expect(s.graph.nodes).toHaveLength(3); expect(isDirty(s)).toBe(true);
    expect(isDirty(run(s, { type: 'undo' }))).toBe(false);
  });

  it('stops adding at the 25-step limit', () => {
    let s = start();
    for (let i = 0; i < 30; i++) s = run(s, { type: 'insert', parentId: 'a1', slot: 'next', node: action(`n${i}`) });
    expect(s.graph.nodes.length).toBe(25); expect(s.notice).toMatch(/at most 25/);
  });
});

function canonicalTitle(s: EditorState): string { return ((nodeById(s.graph, 'a1') as Extract<GraphNode, { type: 'action' }>).data as { title: string }).title; }

describe('canvas actions', () => {
  it('dragging a step stores its position, merges repeated drags into one undo step, and can be undone', () => {
    const s0 = start();
    const s1 = run(s0, { type: 'position', positions: { a1: { x: 10.4, y: 20.6 } } }, { type: 'position', positions: { a1: { x: 40, y: 50 } } });
    expect(nodeById(s1.graph, 'a1')?.pos).toEqual({ x: 40, y: 50 });
    expect(s1.past).toHaveLength(1); expect(isDirty(s1)).toBe(true); ok(s1.graph);
    const s2 = run(s1, { type: 'undo' });
    expect(nodeById(s2.graph, 'a1')?.pos).toBeUndefined(); expect(isDirty(s2)).toBe(false);
  });

  it('ignores positions for steps that do not exist', () => {
    const s0 = start();
    expect(run(s0, { type: 'position', positions: { nope: { x: 1, y: 1 } } })).toBe(s0);
  });

  it('tidy positions every step in one undoable change and announces it', () => {
    const s = run(start(), { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') }, { type: 'tidy' });
    expect(s.graph.nodes.every((n) => n.pos)).toBe(true); ok(s.graph);
    expect(s.notice).toBe('Arranged the steps');
    const back = run(s, { type: 'undo' });
    expect(back.graph.nodes.every((n) => n.pos === undefined)).toBe(true);
  });

  it('refuses a connection that would loop (the canvas shows this refusal) and leaves the graph alone', () => {
    const s0 = run(start(), { type: 'insert', parentId: 'a1', slot: 'next', node: action('a2') });
    const s1 = run(s0, { type: 'connect', from: 'a2', slot: 'next', to: 'a1' });
    expect(s1.noticeIsError).toBe(true); expect(s1.notice).toMatch(/loop/i); expect(s1.graph).toBe(s0.graph);
  });

  it('connecting a wait\'s "if they reply" handle works without adding the path first', () => {
    const s0 = run(start(), { type: 'insert', parentId: 't', slot: 'next', node: defaultNode('wait', 'w') }, { type: 'insert', parentId: 'w', slot: 'next', node: action('late') });
    const s1 = run(s0, { type: 'insert', parentId: 'w', slot: 'replied', node: action('quick') });
    expect(slotEdge(s1.graph, 'w', 'replied')?.to).toBe('quick'); ok(s1.graph);
  });
});
