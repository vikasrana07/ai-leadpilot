import { outEdge, type AutomationGraph, type GraphNode } from '@leadpilot/validation';
import type { Positions } from '@/lib/automation-layout';
import type { Slot } from '@/lib/automation-graph-state';

const RANK: Record<string, number> = { yes: 0, replied: 0, next: 1, no: 2, timeout: 2 };

/**
 * Arrow-key navigation on the canvas: Down follows the first connection out (If before Otherwise), Up goes back to the step that leads here,
 * Left/Right move to the neighbouring step on the same row. Returns the step to focus, or null when there is nowhere to go.
 */
export function neighborOf(graph: AutomationGraph, positions: Positions, id: string, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): string | null {
  if (key === 'ArrowDown') return [...graph.edges].filter((e) => e.from === id).sort((a, b) => (RANK[a.label] ?? 1) - (RANK[b.label] ?? 1))[0]?.to ?? null;
  if (key === 'ArrowUp') return graph.edges.find((e) => e.to === id)?.from ?? null;
  const me = positions[id]; if (!me) return null;
  const row = graph.nodes.filter((n) => positions[n.id] && Math.abs((positions[n.id] as { y: number }).y - me.y) < 4).sort((a, b) => (positions[a.id] as { x: number }).x - (positions[b.id] as { x: number }).x);
  const at = row.findIndex((n) => n.id === id);
  return (key === 'ArrowLeft' ? row[at - 1] : row[at + 1])?.id ?? null;
}

/** Where "Add action / condition / wait" puts a new step: after the selected step (first open side of a condition), or after the trigger when nothing is selected. */
export function addSlotFor(graph: AutomationGraph, selected: string | null): { parent: string; slot: Slot } | null {
  const node: GraphNode | undefined = (selected ? graph.nodes.find((n) => n.id === selected) : undefined) ?? graph.nodes.find((n) => n.type === 'trigger');
  if (!node || node.type === 'end') return null;
  if (node.type === 'branch') return { parent: node.id, slot: !outEdge(graph, node.id, 'yes') ? 'yes' : !outEdge(graph, node.id, 'no') ? 'no' : 'yes' };
  return { parent: node.id, slot: 'next' };
}
