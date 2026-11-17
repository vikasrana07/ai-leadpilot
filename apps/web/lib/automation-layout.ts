import type { AutomationGraph, GraphNode } from '@leadpilot/validation';

/**
 * Layered top-to-bottom layout for the canvas. Pure (no React, no DOM). A step sits one row below the deepest step that leads to it, so
 * paths that rejoin always flow downward; inside a row, steps keep the order they are reached in (If before Otherwise, replied before
 * no reply), and each row is centred on the widest row. Steps that nothing leads to (the editor never makes these, a server graph can)
 * are placed in an extra row at the bottom so they stay visible and deletable.
 */
export const NODE_W = 248;
export const NODE_H = 92;
const GAP_X = 56;
const GAP_Y = 64;

export type Positions = Record<string, { x: number; y: number }>;

export function layoutGraph(g: AutomationGraph): Positions {
  const out = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  const order = new Map<string, number>();
  const slotRank: Record<string, number> = { yes: 0, replied: 0, next: 1, no: 2, timeout: 2 };
  for (const e of [...g.edges].sort((a, b) => (slotRank[a.label] ?? 1) - (slotRank[b.label] ?? 1))) out.get(e.from)?.push(e.to);

  // Longest-path depth from the trigger (the graph is acyclic; the visited guard keeps a malformed one from looping).
  const trigger = g.nodes.find((n) => n.type === 'trigger');
  const depth = new Map<string, number>();
  const visit = (id: string, d: number, stack: Set<string>): void => {
    if (stack.has(id)) return;
    if (!order.has(id)) order.set(id, order.size);
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    stack.add(id);
    for (const to of out.get(id) ?? []) visit(to, d + 1, stack);
    stack.delete(id);
  };
  if (trigger) visit(trigger.id, 0, new Set());
  const maxDepth = Math.max(-1, ...depth.values());
  const stray: GraphNode[] = g.nodes.filter((n) => !depth.has(n.id));
  stray.forEach((n, i) => { depth.set(n.id, maxDepth + 1); order.set(n.id, order.size + i); });

  const rows = new Map<number, string[]>();
  for (const n of g.nodes) { const d = depth.get(n.id) as number; rows.set(d, [...(rows.get(d) ?? []), n.id]); }
  for (const ids of rows.values()) ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const widest = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const totalW = widest * NODE_W + (widest - 1) * GAP_X;

  const pos: Positions = {};
  for (const [d, ids] of rows) {
    const w = ids.length * NODE_W + (ids.length - 1) * GAP_X;
    ids.forEach((id, i) => { pos[id] = { x: Math.round((totalW - w) / 2 + i * (NODE_W + GAP_X)), y: d * (NODE_H + GAP_Y) }; });
  }
  return pos;
}

/** The graph with every step moved to its laid-out position (the "Tidy" button). */
export const tidyGraph = (g: AutomationGraph): AutomationGraph => { const p = layoutGraph(g); return { ...g, nodes: g.nodes.map((n) => ({ ...n, pos: p[n.id] }) as GraphNode) }; };
