import {
  describeActionData, describeConditionData, describeTriggerData, describeWait, GRAPH_LIMITS, outEdge,
  type AutomationGraph, type EdgeLabel, type GraphEdge, type GraphNode,
} from '@leadpilot/validation';
import { tidyGraph, type Positions } from './automation-layout';

/**
 * State of the automation editor: one graph, a selection, undo/redo. Pure (no React, no randomness, no DOM) so the Outline editor and the
 * future canvas drive the SAME reducer and so it can be unit-tested. Every structural rule the user could break lives here:
 * the graph this reducer produces is always acyclic with every node reachable from the trigger (the editor cannot make an orphan).
 */
export const HISTORY_LIMIT = 50;

export type Slot = EdgeLabel;
export type NodeKind = GraphNode['type'];

export interface EditorState {
  graph: AutomationGraph;
  /** Canonical text of the last saved/loaded graph; the editor is "dirty" when the graph differs. */
  baseline: string;
  past: AutomationGraph[];
  future: AutomationGraph[];
  selected: string | null;
  /** Node whose step button should receive focus after the next render (add/delete/move). */
  focus: string | null;
  /** Plain-language description of the last change, announced to screen readers. */
  notice: string;
  /** Bumped whenever `notice` should be announced again (settings edits update the text quietly, without a new announcement). */
  noticeSeq: number;
  /** The last request was refused (e.g. it would have created a loop): shown visibly as well as announced. */
  noticeIsError: boolean;
  /** Edits of one node's settings are merged into one undo step while this key repeats. */
  lastKey: string | null;
}

export type EditorAction =
  | { type: 'load'; graph: AutomationGraph }
  | { type: 'markSaved' }
  | { type: 'select'; id: string | null }
  | { type: 'focusStep'; id: string }
  /** Swap in another graph (a restored draft) as an undoable change, keeping the saved baseline so it shows as unsaved. */
  | { type: 'replace'; graph: AutomationGraph }
  | { type: 'update'; id: string; data: GraphNode['data'] }
  | { type: 'insert'; parentId: string; slot: Slot; node: GraphNode }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; dir: 'up' | 'down' }
  | { type: 'connect'; from: string; slot: Slot; to: string | null }
  /** Canvas: a step was dragged somewhere. Consecutive drags of the same step merge into one undo step. */
  | { type: 'position'; positions: Positions }
  /** Canvas: lay every step out again. */
  | { type: 'tidy' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clearFocus' };

export const canonical = (g: AutomationGraph): string => JSON.stringify(g);
export const isDirty = (s: EditorState): boolean => canonical(s.graph) !== s.baseline;

export function initialState(graph: AutomationGraph): EditorState {
  return { graph, baseline: canonical(graph), past: [], future: [], selected: null, focus: null, notice: '', noticeSeq: 0, noticeIsError: false, lastKey: null };
}

// ----------------------------------------------------------------------------- graph helpers (pure)
export const nodeById = (g: AutomationGraph, id: string): GraphNode | undefined => g.nodes.find((n) => n.id === id);
export const triggerOf = (g: AutomationGraph): GraphNode | undefined => g.nodes.find((n) => n.type === 'trigger');

/** Slots (outgoing connections) a node kind has, in display order. */
export function slotsOf(n: GraphNode, g: AutomationGraph): Slot[] {
  switch (n.type) {
    case 'trigger': case 'action': return ['next'];
    case 'branch': return ['yes', 'no'];
    case 'wait': return outEdge(g, n.id, 'replied') ? ['replied', 'next'] : ['next'];
    case 'end': return [];
  }
}
/** Edge leaving `id` through a slot. A wait's continuation may be stored as `next` or `timeout`. */
export function slotEdge(g: AutomationGraph, id: string, slot: Slot): GraphEdge | undefined {
  const n = nodeById(g, id);
  return n?.type === 'wait' && slot === 'next' ? outEdge(g, id, 'next', 'timeout') : outEdge(g, id, slot);
}
const incoming = (g: AutomationGraph, id: string): GraphEdge[] => g.edges.filter((e) => e.to === id);
/** The edge that carries the "straight on" path of a node (action/wait: next; branch: yes). */
const continuation = (g: AutomationGraph, n: GraphNode): GraphEdge | undefined => (n.type === 'branch' ? outEdge(g, n.id, 'yes') : n.type === 'trigger' || n.type === 'action' ? outEdge(g, n.id, 'next') : n.type === 'wait' ? outEdge(g, n.id, 'next', 'timeout') : undefined);

function edgeId(edges: GraphEdge[], from: string, label: Slot): string {
  const base = `e-${from}-${label}`; let id = base; let i = 2;
  while (edges.some((e) => e.id === id)) id = `${base}-${i++}`;
  return id;
}

function reaches(g: AutomationGraph, start: string, target: string): boolean {
  const seen = new Set<string>([start]); const stack = [start];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === target) return true;
    for (const e of g.edges) if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  }
  return false;
}

/** Drops every node (and connection) that can no longer be reached from the trigger. */
export function prune(g: AutomationGraph): { graph: AutomationGraph; removed: GraphNode[] } {
  const t = triggerOf(g); if (!t) return { graph: g, removed: [] };
  const reach = new Set<string>([t.id]); const stack = [t.id];
  while (stack.length) { const cur = stack.pop() as string; for (const e of g.edges) if (e.from === cur && !reach.has(e.to)) { reach.add(e.to); stack.push(e.to); } }
  const removed = g.nodes.filter((n) => !reach.has(n.id));
  if (removed.length === 0) return { graph: g, removed };
  return { graph: { ...g, nodes: g.nodes.filter((n) => reach.has(n.id)), edges: g.edges.filter((e) => reach.has(e.from) && reach.has(e.to)) }, removed };
}

/** Steps `from`'s `slot` may be pointed at without making a loop (never the trigger, never itself). */
export function validTargets(g: AutomationGraph, from: string, slot: Slot): GraphNode[] {
  const without: AutomationGraph = { ...g, edges: g.edges.filter((e) => e !== slotEdge(g, from, slot)) };
  return g.nodes.filter((n) => n.type !== 'trigger' && n.id !== from && !reaches(without, n.id, from));
}

const SLOT_WORDS: Record<Slot, string> = { next: 'next', yes: 'If', no: 'Otherwise', replied: 'If they reply', timeout: 'If they do not reply' };
export const slotLabel = (n: GraphNode, slot: Slot): string => (n.type === 'wait' ? (slot === 'replied' ? 'If they reply' : 'If they do not reply, or after the wait') : slot === 'next' ? 'Next' : SLOT_WORDS[slot]);

/** One-line plain-language title of a step (also used in announcements). */
export function nodeTitle(n: GraphNode): string {
  switch (n.type) {
    case 'trigger': return `When ${describeTriggerData(n.data)}`;
    case 'action': return describeActionData(n.data).replace(/^./, (c) => c.toUpperCase());
    case 'wait': return `Wait ${describeWait(n.data.minutes)}`;
    case 'branch': return `If ${n.data.conditions.map(describeConditionData).join(n.data.match === 'any' ? ' or ' : ' and ')}`;
    case 'end': return 'Stop';
  }
}

export function defaultNode(kind: 'action' | 'branch' | 'wait', id: string): GraphNode {
  if (kind === 'branch') return { id, type: 'branch', data: { match: 'all', conditions: [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }] } };
  if (kind === 'wait') return { id, type: 'wait', data: { minutes: 1440, exitOnOptOut: true } };
  return { id, type: 'action', data: { type: 'notify', target: 'lead_owner', title: 'Follow up with {{lead.name}}' } };
}

/** The starting point of "New automation": a trigger and one action. */
export function blankGraph(ids: { trigger: string; action: string }): AutomationGraph {
  return {
    v: 1,
    nodes: [{ id: ids.trigger, type: 'trigger', data: { type: 'lead.created' } }, { id: ids.action, type: 'action', data: { type: 'notify', target: 'managers', title: 'New lead: {{lead.name}}' } }],
    edges: [{ id: `e-${ids.trigger}-next`, from: ids.trigger, to: ids.action, label: 'next' }],
  };
}

// ----------------------------------------------------------------------------- structural edits (pure; each returns the new graph or an error)
type Edit = { graph: AutomationGraph; notice: string; focus?: string | null; selected?: string | null; quiet?: boolean } | { error: string };

function insertNode(g: AutomationGraph, parentId: string, slot: Slot, node: GraphNode): Edit {
  if (g.nodes.length >= GRAPH_LIMITS.nodes) return { error: `An automation can have at most ${GRAPH_LIMITS.nodes} steps.` };
  const parent = nodeById(g, parentId); if (!parent) return { error: 'That step no longer exists.' };
  if (!slotsOf(parent, g).includes(slot) && !(parent.type === 'wait' && slot === 'replied')) return { error: 'That step has no such path.' };
  if (g.nodes.some((n) => n.id === node.id)) return { error: 'Duplicate step id.' };
  const old = slotEdge(g, parentId, slot);
  let edges = g.edges.filter((e) => e !== old);
  const label: Slot = parent.type === 'wait' && slot === 'next' ? 'next' : slot;
  edges = [...edges, { id: edgeId(edges, parentId, label), from: parentId, to: node.id, label }];
  if (old) { const cont: Slot = node.type === 'branch' ? 'yes' : 'next'; edges = [...edges, { id: edgeId(edges, node.id, cont), from: node.id, to: old.to, label: cont }]; }
  return { graph: { ...g, nodes: [...g.nodes, node], edges }, notice: `Added step: ${nodeTitle(node)}`, focus: node.id, selected: node.id };
}

function removeNode(g: AutomationGraph, id: string): Edit {
  const n = nodeById(g, id); if (!n) return { error: 'That step no longer exists.' };
  if (n.type === 'trigger') return { error: 'The trigger cannot be deleted. Change it instead.' };
  const cont = continuation(g, n);
  const ins = incoming(g, id);
  let edges = g.edges.filter((e) => e.to !== id && e.from !== id);
  if (cont) for (const inc of ins) edges = [...edges, { id: edgeId(edges, inc.from, inc.label), from: inc.from, to: cont.to, label: inc.label }];
  const { graph, removed } = prune({ ...g, nodes: g.nodes.filter((x) => x.id !== id), edges });
  const extra = removed.length ? ` and ${removed.length} step${removed.length === 1 ? '' : 's'} that only it led to` : '';
  return { graph, notice: `Deleted step: ${nodeTitle(n)}${extra}`, focus: ins[0]?.from ?? triggerOf(g)?.id ?? null, selected: null };
}

function movable(g: AutomationGraph, n: GraphNode | undefined): n is Extract<GraphNode, { type: 'action' | 'wait' }> {
  return !!n && (n.type === 'action' || n.type === 'wait') && !outEdge(g, n.id, 'replied') && incoming(g, n.id).length === 1;
}

function moveNode(g: AutomationGraph, id: string, dir: 'up' | 'down'): Edit {
  const n = nodeById(g, id);
  if (!movable(g, n)) return { error: 'This step cannot be moved here. Steps with several paths or connections stay where they are.' };
  const parentEdge = incoming(g, id)[0] as GraphEdge;
  const parent = nodeById(g, parentEdge.from) as GraphNode;
  // Moving up is moving the parent down; the pair swaps places either way.
  const top = dir === 'down' ? n : parent; const bottom = dir === 'down' ? nodeById(g, continuation(g, n)?.to ?? '') : n;
  if (dir === 'up' && !movable(g, parent)) return { error: 'This step is already first, or the step above it cannot be moved.' };
  if (!bottom || !movable(g, bottom) || !movable(g, top)) return { error: dir === 'down' ? 'This step is already last on its path.' : 'This step is already first on its path.' };
  const above = incoming(g, top.id)[0] as GraphEdge; // P --l--> top
  const topNext = continuation(g, top) as GraphEdge; // top --> bottom
  if (topNext.to !== bottom.id) return { error: 'These steps are not next to each other.' };
  const bottomNext = continuation(g, bottom); // bottom --> D (optional)
  let edges = g.edges.filter((e) => e !== above && e !== topNext && e !== bottomNext);
  edges = [...edges, { id: edgeId(edges, above.from, above.label), from: above.from, to: bottom.id, label: above.label }];
  edges = [...edges, { id: edgeId(edges, bottom.id, 'next'), from: bottom.id, to: top.id, label: 'next' }];
  if (bottomNext) edges = [...edges, { id: edgeId(edges, top.id, 'next'), from: top.id, to: bottomNext.to, label: 'next' }];
  return { graph: { ...g, edges }, notice: `Moved step ${dir}: ${nodeTitle(n)}`, focus: id, selected: id };
}

function connect(g: AutomationGraph, from: string, slot: Slot, to: string | null): Edit {
  const f = nodeById(g, from); if (!f) return { error: 'That step no longer exists.' };
  if (!slotsOf(f, g).includes(slot) && !(f.type === 'wait' && slot === 'replied')) return { error: 'That step has no such path.' };
  const old = slotEdge(g, from, slot);
  let edges = g.edges.filter((e) => e !== old);
  let notice = `Path "${slotLabel(f, slot)}" of "${nodeTitle(f)}" now stops`;
  if (to !== null) {
    const target = nodeById(g, to);
    if (!target || target.type === 'trigger' || to === from) return { error: 'That step cannot be connected there.' };
    if (reaches({ ...g, edges }, to, from)) return { error: 'That would loop back on itself. Steps must flow forward only.' };
    const label: Slot = f.type === 'wait' && slot === 'next' ? 'next' : slot;
    edges = [...edges, { id: edgeId(edges, from, label), from, to, label }];
    notice = `Path "${slotLabel(f, slot)}" of "${nodeTitle(f)}" now continues to "${nodeTitle(target)}"`;
  }
  const { graph, removed } = prune({ ...g, edges });
  if (removed.length) notice += `. ${removed.length} step${removed.length === 1 ? '' : 's'} that nothing leads to any more ${removed.length === 1 ? 'was' : 'were'} removed (you can undo)`;
  return { graph, notice, focus: from, selected: from };
}

// ----------------------------------------------------------------------------- reducer
function commit(s: EditorState, e: Edit, key: string | null = null): EditorState {
  if ('error' in e) return { ...s, notice: e.error, noticeSeq: s.noticeSeq + 1, noticeIsError: true, lastKey: null };
  if (canonical(e.graph) === canonical(s.graph)) return { ...s, lastKey: key };
  const merge = key !== null && s.lastKey === key && s.past.length > 0;
  const past = merge ? s.past : [...s.past, s.graph].slice(-HISTORY_LIMIT);
  const selected = e.selected !== undefined ? e.selected : s.selected && nodeById(e.graph, s.selected) ? s.selected : null;
  return { ...s, graph: e.graph, past, future: [], selected, focus: e.focus ?? s.focus, notice: e.notice, noticeSeq: e.quiet ? s.noticeSeq : s.noticeSeq + 1, noticeIsError: false, lastKey: key };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'load': return initialState(a.graph);
    case 'markSaved': return { ...s, baseline: canonical(s.graph), lastKey: null };
    case 'select': return { ...s, selected: a.id, lastKey: null };
    case 'focusStep': return { ...s, focus: a.id };
    case 'replace': return commit(s, { graph: a.graph, notice: 'Restored your unsaved draft', selected: null });
    case 'clearFocus': return s.focus === null ? s : { ...s, focus: null };
    case 'update': {
      const n = nodeById(s.graph, a.id); if (!n) return s;
      const next = { ...n, data: a.data } as GraphNode;
      return commit(s, { graph: { ...s.graph, nodes: s.graph.nodes.map((x) => (x.id === a.id ? next : x)) }, notice: `Updated step: ${nodeTitle(next)}`, quiet: true }, `update:${a.id}`);
    }
    case 'position': {
      const ids = Object.keys(a.positions).filter((id) => nodeById(s.graph, id)); if (!ids.length) return s;
      const nodes = s.graph.nodes.map((n) => { const p = a.positions[n.id]; return p && ids.includes(n.id) ? ({ ...n, pos: { x: Math.round(p.x), y: Math.round(p.y) } } as GraphNode) : n; });
      return commit(s, { graph: { ...s.graph, nodes }, notice: 'Moved a step', quiet: true }, `pos:${ids.join(',')}`);
    }
    case 'tidy': return commit(s, { graph: tidyGraph(s.graph), notice: 'Arranged the steps' });
    case 'insert': return commit(s, insertNode(s.graph, a.parentId, a.slot, a.node));
    case 'remove': return commit(s, removeNode(s.graph, a.id));
    case 'move': return commit(s, moveNode(s.graph, a.id, a.dir));
    case 'connect': return commit(s, connect(s.graph, a.from, a.slot, a.to));
    case 'undo': {
      const prev = s.past[s.past.length - 1]; if (!prev) return { ...s, notice: 'Nothing to undo', noticeSeq: s.noticeSeq + 1, noticeIsError: false };
      return { ...s, graph: prev, past: s.past.slice(0, -1), future: [s.graph, ...s.future].slice(0, HISTORY_LIMIT), selected: s.selected && nodeById(prev, s.selected) ? s.selected : null, notice: 'Undid the last change', noticeSeq: s.noticeSeq + 1, noticeIsError: false, lastKey: null };
    }
    case 'redo': {
      const nxt = s.future[0]; if (!nxt) return { ...s, notice: 'Nothing to redo', noticeSeq: s.noticeSeq + 1, noticeIsError: false };
      return { ...s, graph: nxt, past: [...s.past, s.graph].slice(-HISTORY_LIMIT), future: s.future.slice(1), selected: s.selected && nodeById(nxt, s.selected) ? s.selected : null, notice: 'Redid the change', noticeSeq: s.noticeSeq + 1, noticeIsError: false, lastKey: null };
    }
  }
}
