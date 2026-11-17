import type { Prisma, TxClient } from '@leadpilot/database';
import { describeConditionData, graphSchema, outEdge, type AutomationGraph, type BranchData, type EdgeLabel, type GraphNode } from '@leadpilot/validation';
import { evaluateCondition, type EvalContext } from './automation-logic.js';

/** One entry of `automation_runs.steps`. `i` is the visit order (for a converted linear automation: the action index), `nodeId` ties it to the graph. */
export interface StepRecord {
  i: number; nodeId?: string; type: string;
  status: 'done' | 'skipped' | 'failed' | 'preview' | 'waiting';
  detail?: string;
  /** branch nodes: which side was taken; wait nodes: how the wait ended (`replied` or `timeout`) */
  branch?: EdgeLabel;
  /** wait nodes: when the wait ends */
  resumeAt?: string;
  at?: string;
  conditions?: { text: string; pass: boolean }[];
}

export type Cursor = { kind: 'node'; node: GraphNode } | { kind: 'waiting'; node: GraphNode; step: StepRecord } | { kind: 'end' };

/** Steps written before the graph engine carry no node id: an action step `i` is the linear action `a{i+1}`. */
export const nodeIdOf = (s: StepRecord): string | undefined => s.nodeId ?? (s.i >= 0 && s.type !== 'gate' ? `a${s.i + 1}` : undefined);

/** Pure branch evaluation with the per-condition result (shown in dry runs and run history). */
export function evaluateBranch(data: BranchData, ctx: EvalContext): { pass: boolean; conditions: { text: string; pass: boolean }[] } {
  const conditions = data.conditions.map((c) => ({ text: describeConditionData(c), pass: evaluateCondition(c, ctx) }));
  return { pass: data.match === 'any' ? conditions.some((c) => c.pass) : conditions.every((c) => c.pass), conditions };
}

/**
 * Where a run continues, rebuilt from its recorded steps alone. This is what makes retries, crash recovery and resumption after a wait safe:
 * finished nodes are never executed again and a recorded branch decision is followed, never re-decided against changed lead data.
 * `linearSource`: the graph was lifted from a legacy automation whose conditions were already gated before the run, so its branch is
 * passed through (the `yes` side) without a recorded step.
 */
export function cursorFrom(g: AutomationGraph, steps: StepRecord[], linearSource: boolean): Cursor {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const trigger = g.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return { kind: 'end' };
  const stepFor = (id: string): StepRecord | undefined => [...steps].reverse().find((s) => s.status !== 'failed' && nodeIdOf(s) === id);
  let id = outEdge(g, trigger.id, 'next')?.to;
  for (let guard = 0; id && guard <= g.nodes.length; guard++) {
    const node = byId.get(id); if (!node) return { kind: 'end' };
    const step = stepFor(node.id);
    switch (node.type) {
      case 'branch':
        if (linearSource) { id = outEdge(g, node.id, 'yes')?.to; break; }
        if (!step) return { kind: 'node', node };
        id = outEdge(g, node.id, step.branch === 'no' ? 'no' : 'yes')?.to; break;
      case 'action':
        if (!step) return { kind: 'node', node };
        id = outEdge(g, node.id, 'next')?.to; break;
      case 'wait':
        if (!step) return { kind: 'node', node };
        if (step.status === 'waiting') return { kind: 'waiting', node, step };
        id = (step.branch === 'replied' ? outEdge(g, node.id, 'replied') : outEdge(g, node.id, 'timeout', 'next'))?.to; break;
      case 'end': return { kind: 'end' };
      case 'trigger': return { kind: 'end' };
    }
  }
  return { kind: 'end' };
}

export const parseGraph = (json: unknown): AutomationGraph => graphSchema.parse(json);

// ----------------------------------------------------------------------------- waiting runs (tx-level helpers: used by the engine, the scanner and the API)
const asSteps = (v: unknown): StepRecord[] => (Array.isArray(v) ? (v as StepRecord[]) : []);

/**
 * Ends a wait: the run goes back to QUEUED and the wait step records how it ended (`timeout` = the deadline passed, `replied` = the customer
 * wrote). Compare-and-set on the WAITING status, so a reply and the deadline arriving together resume the run exactly once.
 */
export async function resumeWaitingRun(tx: TxClient, runId: string, via: 'timeout' | 'replied', now = new Date()): Promise<boolean> {
  const run = await tx.automationRun.findFirst({ where: { id: runId, status: 'WAITING' }, select: { steps: true, waitingNode: true } });
  if (!run) return false;
  const steps = asSteps(run.steps).map((s) => (s.status === 'waiting' && s.nodeId === run.waitingNode
    ? { ...s, status: 'done' as const, branch: via, at: now.toISOString(), detail: via === 'replied' ? 'The customer replied' : 'The wait finished with no reply' }
    : s));
  const claimed = await tx.automationRun.updateMany({ where: { id: runId, status: 'WAITING' }, data: { status: 'QUEUED', resumeAt: null, waitingNode: null, steps: steps as unknown as Prisma.InputJsonValue } });
  return claimed.count === 1;
}

/** Ends waiting runs for good (opt-out, automation disabled...). Recorded as SKIPPED with the reason, never silently dropped. */
export async function endWaitingRuns(tx: TxClient, where: { tenantId: string; leadId?: string; automationId?: string }, reason: string, now = new Date()): Promise<number> {
  const runs = await tx.automationRun.findMany({ where: { ...where, status: 'WAITING' }, select: { id: true, steps: true } });
  let n = 0;
  for (const r of runs) {
    const steps = asSteps(r.steps).map((s) => (s.status === 'waiting' ? { ...s, status: 'skipped' as const, detail: reason, at: now.toISOString() } : s));
    const done = await tx.automationRun.updateMany({ where: { id: r.id, status: 'WAITING' }, data: { status: 'SKIPPED', finishedAt: now, resumeAt: null, waitingNode: null, error: null, steps: steps as unknown as Prisma.InputJsonValue } });
    n += done.count;
  }
  return n;
}
