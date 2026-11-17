import type { AutomationGraph } from '@leadpilot/validation';
import type { DryRunPathItem } from '@/lib/ops';

/**
 * What a test (dry run) or a past run did at each step, in one shape the canvas can draw. Every mark has words and an icon name, so the
 * result never depends on colour alone.
 */
export type MarkState = 'start' | 'ran' | 'skipped' | 'failed' | 'waiting' | 'yes' | 'no' | 'wait_sim' | 'would_run';
export interface NodeMark { state: MarkState; text: string; detail?: string | undefined; conditions?: { text: string; pass: boolean }[] | undefined; branch?: 'yes' | 'no' | undefined }
export interface RunStep { i: number; nodeId?: string; type: string; status: string; detail?: string; branch?: string; conditions?: { text: string; pass: boolean }[] }

const minutesText = (m: number): string => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

/** Dry-run path (from the Test dialog) as marks. The trigger always counts as reached. */
export function marksFromDryRun(graph: AutomationGraph, path: DryRunPathItem[]): Map<string, NodeMark> {
  const marks = new Map<string, NodeMark>();
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  if (trigger) marks.set(trigger.id, { state: 'start', text: 'Test started here' });
  for (const p of path) {
    if (p.outcome === 'yes') marks.set(p.nodeId, { state: 'yes', branch: 'yes', text: 'Condition met: takes the If path', conditions: p.conditions });
    else if (p.outcome === 'no') marks.set(p.nodeId, { state: 'no', branch: 'no', text: 'Condition not met: takes Otherwise', conditions: p.conditions });
    else if (p.outcome === 'would_wait') marks.set(p.nodeId, { state: 'wait_sim', text: `Would wait ${p.wouldWaitMinutes ? minutesText(p.wouldWaitMinutes) : ''}`.trim(), detail: p.detail });
    else if (p.outcome === 'skipped') marks.set(p.nodeId, { state: 'skipped', text: 'Would be skipped', detail: p.detail });
    else marks.set(p.nodeId, { state: 'would_run', text: 'Would run', detail: p.detail });
  }
  return marks;
}

/** Recorded steps of a real run as marks (later steps for the same step win, e.g. a failed attempt that was retried). */
export function marksFromRun(graph: AutomationGraph, steps: RunStep[]): Map<string, NodeMark> {
  const marks = new Map<string, NodeMark>();
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  const real = steps.filter((s) => s.nodeId);
  if (trigger && real.length) marks.set(trigger.id, { state: 'start', text: 'Run started here' });
  for (const s of [...real].sort((a, b) => a.i - b.i)) {
    const id = s.nodeId as string;
    if (s.type === 'branch') marks.set(id, { state: s.branch === 'no' ? 'no' : 'yes', branch: s.branch === 'no' ? 'no' : 'yes', text: s.branch === 'no' ? 'Condition not met: took Otherwise' : 'Condition met: took the If path', conditions: s.conditions });
    else if (s.status === 'preview' && s.type === 'wait') marks.set(id, { state: 'wait_sim', text: 'Would wait', detail: s.detail });
    else if (s.status === 'preview') marks.set(id, { state: 'would_run', text: 'Would run', detail: s.detail });
    else if (s.status === 'waiting') marks.set(id, { state: 'waiting', text: 'Waiting here', detail: s.detail });
    else if (s.status === 'failed') marks.set(id, { state: 'failed', text: 'Failed', detail: s.detail });
    else if (s.status === 'skipped') marks.set(id, { state: 'skipped', text: 'Skipped', detail: s.detail });
    else if (s.type === 'wait') marks.set(id, { state: 'ran', text: 'Waited, then continued', detail: s.detail });
    else marks.set(id, { state: 'ran', text: 'Ran', detail: s.detail });
  }
  return marks;
}

/** Connections the test or run actually followed: both ends reached, and for a condition only the side that was taken. */
export function takenEdges(graph: AutomationGraph, marks: Map<string, NodeMark>): Set<string> {
  const taken = new Set<string>();
  for (const e of graph.edges) {
    const from = marks.get(e.from); const to = marks.get(e.to);
    if (!from || !to) continue;
    if (from.branch && from.branch !== e.label) continue;
    taken.add(e.id);
  }
  return taken;
}

/** Steps recorded by a run that no longer exist in the graph being shown (it was edited since). */
export const missingFromGraph = (graph: AutomationGraph, steps: RunStep[]): number => {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return new Set(steps.filter((s) => s.nodeId && !ids.has(s.nodeId)).map((s) => s.nodeId)).size;
};
