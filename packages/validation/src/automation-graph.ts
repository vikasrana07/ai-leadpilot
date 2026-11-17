import { z } from 'zod';
import {
  actionSchema, conditionSchema, triggerSchema,
  type AutomationAction, type AutomationCondition, type AutomationTrigger,
} from './ops.js';

/**
 * Automation graph (version 1): a trigger, branch nodes (if / otherwise), action nodes and wait nodes, joined by labelled edges.
 * The graph is a DAG with one trigger. A node whose outgoing edge is missing simply ends that path (a warning, not an error).
 * A linear automation (trigger + AND-ed conditions + ordered actions) converts losslessly with `linearToGraph`.
 */
export const GRAPH_LIMITS = { nodes: 25, depth: 12, actions: 12, waitsPerPath: 3, waitMinutes: 30 * 24 * 60, bytes: 64 * 1024, conditionsPerBranch: 8 } as const;

export const EDGE_LABELS = ['next', 'yes', 'no', 'replied', 'timeout'] as const;
export type EdgeLabel = (typeof EDGE_LABELS)[number];

const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Node ids use letters, digits, - and _');
const pos = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).optional();
const label = z.string().trim().max(80).optional();
const base = { id: nodeId, pos, label };

export const waitDataSchema = z.object({
  minutes: z.number().int().min(1).max(GRAPH_LIMITS.waitMinutes),
  /** Always true: a customer who opts out ends every waiting run. Kept in the data so the contract is explicit. */
  exitOnOptOut: z.literal(true).default(true),
});
export const branchDataSchema = z.object({ match: z.enum(['all', 'any']).default('all'), conditions: z.array(conditionSchema).min(1).max(GRAPH_LIMITS.conditionsPerBranch) });

export const graphNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('trigger'), data: triggerSchema }),
  z.object({ ...base, type: z.literal('branch'), data: branchDataSchema }),
  z.object({ ...base, type: z.literal('action'), data: actionSchema }),
  z.object({ ...base, type: z.literal('wait'), data: waitDataSchema }),
  z.object({ ...base, type: z.literal('end'), data: z.object({}).default({}) }),
]);
export const graphEdgeSchema = z.object({ id: nodeId, from: nodeId, to: nodeId, label: z.enum(EDGE_LABELS).default('next') });
export const graphSchema = z.object({
  v: z.literal(1),
  nodes: z.array(graphNodeSchema).min(1).max(GRAPH_LIMITS.nodes),
  edges: z.array(graphEdgeSchema).max(GRAPH_LIMITS.nodes * 2),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type AutomationGraph = z.infer<typeof graphSchema>;
export type BranchData = z.infer<typeof branchDataSchema>;

export interface GraphIssue { severity: 'error' | 'warning'; code: string; message: string; nodeId?: string; edgeId?: string }

const err = (code: string, message: string, extra: { nodeId?: string; edgeId?: string } = {}): GraphIssue => ({ severity: 'error', code, message, ...extra });
const warn = (code: string, message: string, extra: { nodeId?: string; edgeId?: string } = {}): GraphIssue => ({ severity: 'warning', code, message, ...extra });

/** Outgoing edge for `from` with one of the labels (wait nodes treat `next` as the timeout path). */
export function outEdge(g: AutomationGraph, from: string, ...labels: EdgeLabel[]): GraphEdge | undefined {
  return g.edges.find((e) => e.from === from && labels.includes(e.label));
}

const ALLOWED_OUT: Record<GraphNode['type'], readonly EdgeLabel[]> = {
  trigger: ['next'], action: ['next'], branch: ['yes', 'no'], wait: ['next', 'timeout', 'replied'], end: [],
};

/**
 * Structural validation of a graph. Returns every problem found (errors block saving, warnings do not), each tied to a node or edge so a
 * UI can show it in place. Pure and synchronous; assignee/stage existence is checked separately against the database.
 */
export function validateGraph(input: unknown): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const size = (() => { try { return JSON.stringify(input).length; } catch { return Infinity; } })();
  if (size > GRAPH_LIMITS.bytes) return [err('too_large', `The automation is too large (limit ${GRAPH_LIMITS.bytes / 1024} KB)`)];
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const [first, idx] = i.path;
      const node = first === 'nodes' && typeof idx === 'number' ? (input as { nodes?: { id?: unknown }[] }).nodes?.[idx]?.id : undefined;
      issues.push(err('schema', `${i.path.join('.') || 'graph'}: ${i.message}`, typeof node === 'string' ? { nodeId: node } : {}));
    }
    return issues;
  }
  const g = parsed.data;
  const byId = new Map<string, GraphNode>();
  for (const n of g.nodes) {
    if (byId.has(n.id)) issues.push(err('duplicate_node', `Two steps share the id "${n.id}"`, { nodeId: n.id }));
    byId.set(n.id, n);
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) issues.push(err('duplicate_edge', `Two connections share the id "${e.id}"`, { edgeId: e.id }));
    edgeIds.add(e.id);
    if (!byId.has(e.from) || !byId.has(e.to)) issues.push(err('edge_ref', 'A connection points to a step that does not exist', { edgeId: e.id }));
    if (e.from === e.to) issues.push(err('self_loop', 'A step cannot connect to itself', { edgeId: e.id }));
  }
  if (issues.some((i) => i.code === 'edge_ref' || i.code === 'duplicate_node')) return issues;

  const triggers = g.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) { issues.push(err('trigger_count', triggers.length === 0 ? 'Add a trigger: what starts this automation?' : 'An automation has exactly one trigger')); return issues; }
  const trigger = triggers[0] as GraphNode;
  if (g.edges.some((e) => e.to === trigger.id)) issues.push(err('trigger_incoming', 'Nothing can lead back into the trigger', { nodeId: trigger.id }));

  for (const n of g.nodes) {
    const outs = g.edges.filter((e) => e.from === n.id);
    for (const e of outs) if (!ALLOWED_OUT[n.type].includes(e.label)) issues.push(err('edge_label', `A ${n.type} step cannot have a "${e.label}" connection`, { nodeId: n.id, edgeId: e.id }));
    for (const l of EDGE_LABELS) if (outs.filter((e) => e.label === l).length > 1) issues.push(err('edge_duplicate_label', `A step has more than one "${l}" connection`, { nodeId: n.id }));
    if (n.type === 'wait' && outs.some((e) => e.label === 'next') && outs.some((e) => e.label === 'timeout')) issues.push(err('wait_edges', 'A wait step uses either "next" or "timeout", not both', { nodeId: n.id }));
    if (n.type === 'trigger' || n.type === 'action') { if (outs.length === 0 && n.type === 'trigger') issues.push(err('trigger_empty', 'Connect the trigger to a first step', { nodeId: n.id })); }
    if (n.type === 'branch') for (const l of ['yes', 'no'] as const) if (!outs.some((e) => e.label === l)) issues.push(warn('branch_open', `The "${l === 'yes' ? 'If' : 'Otherwise'}" side is not connected, so the automation stops there`, { nodeId: n.id }));
    if (n.type === 'wait' && !outs.some((e) => e.label === 'next' || e.label === 'timeout')) issues.push(warn('wait_open', 'Nothing happens after the wait', { nodeId: n.id }));
  }

  // acyclic (Kahn) + reachability
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = g.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift() as string; topo.push(id);
    for (const e of g.edges) if (e.from === id) { indeg.set(e.to, (indeg.get(e.to) ?? 0) - 1); if (indeg.get(e.to) === 0) queue.push(e.to); }
  }
  if (topo.length !== g.nodes.length) { issues.push(err('cycle', 'The automation loops back on itself. Steps must flow forward only.')); return issues; }
  const reach = new Set<string>([trigger.id]);
  for (const id of topo) if (reach.has(id)) for (const e of g.edges) if (e.from === id) reach.add(e.to);
  for (const n of g.nodes) if (!reach.has(n.id)) issues.push(err('unreachable', 'This step is not connected to the trigger', { nodeId: n.id }));

  const actions = g.nodes.filter((n) => n.type === 'action');
  if (actions.length === 0) issues.push(err('no_actions', 'Add at least one action'));
  if (actions.length > GRAPH_LIMITS.actions) issues.push(err('too_many_actions', `At most ${GRAPH_LIMITS.actions} actions per automation`));

  // longest path (steps) and most waits on any path, over reachable nodes in topological order
  const depth = new Map<string, number>([[trigger.id, 1]]); const waits = new Map<string, number>([[trigger.id, 0]]);
  for (const id of topo) {
    if (!reach.has(id)) continue;
    const d = depth.get(id) ?? 1; const w = waits.get(id) ?? 0;
    for (const e of g.edges) if (e.from === id) {
      depth.set(e.to, Math.max(depth.get(e.to) ?? 0, d + 1));
      const to = byId.get(e.to) as GraphNode;
      waits.set(e.to, Math.max(waits.get(e.to) ?? 0, w + (to.type === 'wait' ? 1 : 0)));
    }
  }
  const maxDepth = Math.max(...[...depth.values()]); const maxWaits = Math.max(...[...waits.values()]);
  if (maxDepth > GRAPH_LIMITS.depth) issues.push(err('too_deep', `A path has ${maxDepth} steps; the limit is ${GRAPH_LIMITS.depth}`));
  if (maxWaits > GRAPH_LIMITS.waitsPerPath) issues.push(err('too_many_waits', `A path has ${maxWaits} waits; the limit is ${GRAPH_LIMITS.waitsPerPath}`));
  return issues;
}

export const graphErrors = (issues: GraphIssue[]): GraphIssue[] => issues.filter((i) => i.severity === 'error');

// ----------------------------------------------------------------------------- linear <-> graph
export interface LinearDefinition { trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[] }

/** Lossless conversion: trigger, then (if there are conditions) one `all` branch whose `no` side ends, then the actions in order. */
export function linearToGraph(d: LinearDefinition): AutomationGraph {
  const nodes: GraphNode[] = [{ id: 't', type: 'trigger', data: d.trigger }];
  const edges: GraphEdge[] = [];
  let prev = 't'; let prevLabel: EdgeLabel = 'next';
  if (d.conditions.length > 0) {
    nodes.push({ id: 'c', type: 'branch', data: { match: 'all', conditions: d.conditions } });
    edges.push({ id: 'e-t-c', from: 't', to: 'c', label: 'next' });
    prev = 'c'; prevLabel = 'yes';
  }
  d.actions.forEach((a, i) => {
    const id = `a${i + 1}`;
    nodes.push({ id, type: 'action', data: a });
    edges.push({ id: `e-${prev}-${id}`, from: prev, to: id, label: prevLabel });
    prev = id; prevLabel = 'next';
  });
  return { v: 1, nodes, edges };
}

/** Inverse of `linearToGraph` for graphs of that exact shape; null when the graph branches, waits or otherwise is not linear. */
export function graphToLinear(g: AutomationGraph): LinearDefinition | null {
  const trigger = g.nodes.find((n) => n.type === 'trigger'); if (!trigger || trigger.type !== 'trigger') return null;
  const conditions: AutomationCondition[] = []; const actions: AutomationAction[] = [];
  let cur: GraphNode = trigger; let seenBranch = false;
  const seen = new Set<string>();
  for (;;) {
    const e: GraphEdge | undefined = cur.type === 'branch' ? outEdge(g, cur.id, 'yes') : outEdge(g, cur.id, 'next');
    if (cur.type === 'branch' && outEdge(g, cur.id, 'no')) return null;
    if (!e) break;
    const nxt: GraphNode | undefined = g.nodes.find((n) => n.id === e.to); if (!nxt || seen.has(nxt.id)) return null;
    seen.add(nxt.id);
    if (nxt.type === 'branch') { if (seenBranch || actions.length > 0 || nxt.data.match !== 'all') return null; seenBranch = true; conditions.push(...nxt.data.conditions); }
    else if (nxt.type === 'action') actions.push(nxt.data);
    else return null;
    cur = nxt;
  }
  if (seen.size + 1 !== g.nodes.length) return null;
  return { trigger: trigger.data, conditions, actions };
}

/** The trigger configuration of a graph (every valid graph has exactly one trigger node). */
export function graphTrigger(g: AutomationGraph): AutomationTrigger {
  const t = g.nodes.find((n) => n.type === 'trigger');
  if (!t || t.type !== 'trigger') throw new Error('graph has no trigger');
  return t.data;
}

/** Every action in a graph, in node order (all branches). Used for lookups that do not care about the path, e.g. required WhatsApp templates. */
export const graphActions = (g: AutomationGraph): AutomationAction[] => g.nodes.flatMap((n) => (n.type === 'action' ? [n.data] : []));

/** The graph that runs for an automation row: its stored graph, or its legacy linear definition converted. */
export function effectiveGraph(row: { graph?: unknown; trigger: unknown; conditions: unknown; actions: unknown }): AutomationGraph {
  if (row.graph) return graphSchema.parse(row.graph);
  return linearToGraph({ trigger: row.trigger as AutomationTrigger, conditions: (row.conditions ?? []) as AutomationCondition[], actions: row.actions as AutomationAction[] });
}

// ----------------------------------------------------------------------------- plain English
const FIELD_LABEL: Record<string, string> = { 'lead.stage': 'stage', 'lead.temperature': 'temperature', 'lead.score': 'score', 'lead.source': 'source', 'lead.assigned': 'is assigned', 'lead.budgetMax': 'maximum budget', 'lead.location': 'location', 'event.toStage': 'new stage', 'event.toTemperature': 'new temperature' };
const OP_LABEL: Record<string, string> = { eq: 'is', neq: 'is not', gt: 'is above', gte: 'is at least', lt: 'is below', lte: 'is at most', in: 'is one of' };
export const TRIGGER_LABEL: Record<string, string> = {
  'lead.created': 'a lead is created', 'lead.assigned': 'a lead is assigned', 'lead.stage_changed': 'a lead changes stage', 'lead.temperature_changed': 'a lead changes temperature',
  'lead.inactive': 'a lead goes quiet', 'message.inbound': 'a customer messages', 'conversation.handover': 'a conversation is handed to a person',
  'appointment.booked': 'an appointment is booked', 'appointment.confirmed': 'an appointment is confirmed', 'appointment.cancelled': 'an appointment is cancelled',
  'appointment.rescheduled': 'an appointment is rescheduled', 'appointment.completed': 'an appointment is completed', 'appointment.no_show': 'a customer does not show up',
  'appointment.upcoming': 'an appointment is coming up', 'task.due': 'a task is due', 'sla.breached': 'a reply deadline is missed',
};
const ACTION_LABEL: Record<AutomationAction['type'], (a: never) => string> = {
  send_whatsapp_template: (a: Extract<AutomationAction, { type: 'send_whatsapp_template' }>) => `send the WhatsApp template "${a.template}"`,
  send_message: (a: Extract<AutomationAction, { type: 'send_message' }>) => `send the message "${a.text.length > 60 ? `${a.text.slice(0, 57)}...` : a.text}"`,
  assign_round_robin: () => 'assign the lead to the least busy agent',
  assign_to: () => 'assign the lead to a chosen team member',
  create_task: (a: Extract<AutomationAction, { type: 'create_task' }>) => `create the task "${a.title}" due in ${a.dueInHours}h`,
  notify: (a: Extract<AutomationAction, { type: 'notify' }>) => `notify ${a.target === 'managers' ? 'managers' : 'the lead owner'}: "${a.title}"`,
  change_stage: (a: Extract<AutomationAction, { type: 'change_stage' }>) => `move the lead to "${a.stageKey}"`,
  add_tag: (a: Extract<AutomationAction, { type: 'add_tag' }>) => `add the tag "${a.tag}"`,
} as Record<AutomationAction['type'], (a: never) => string>;

export const describeTriggerData = (t: AutomationTrigger): string => `${TRIGGER_LABEL[t.type] ?? t.type}${t.type === 'appointment.upcoming' && t.hoursBefore ? ` (${t.hoursBefore}h before)` : ''}${t.type === 'lead.inactive' && t.days ? ` (${t.days} days)` : ''}`;
export const describeConditionData = (c: AutomationCondition): string => `${FIELD_LABEL[c.field] ?? c.field} ${OP_LABEL[c.op] ?? c.op} ${Array.isArray(c.value) ? c.value.join(', ') : String(c.value)}`;
export const describeActionData = (a: AutomationAction): string => (ACTION_LABEL[a.type] as (a: AutomationAction) => string)(a);
export const describeWait = (minutes: number): string => (minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? '' : 's'}` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`);

/** Indented plain-English outline of a valid graph (also the accessible text alternative to the canvas). Invalid graphs return an empty list. */
export function summarizeGraph(g: AutomationGraph): string[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const trigger = g.nodes.find((n) => n.type === 'trigger');
  if (!trigger || trigger.type !== 'trigger') return [];
  const lines = [`When ${describeTriggerData(trigger.data)}:`];
  const seen = new Set<string>();
  const walk = (id: string | undefined, indent: number) => {
    if (!id || seen.has(id)) return;
    const n = byId.get(id); if (!n) return;
    seen.add(id);
    const pad = '  '.repeat(indent);
    switch (n.type) {
      case 'action': lines.push(`${pad}- ${describeActionData(n.data)}`); walk(outEdge(g, id, 'next')?.to, indent); break;
      case 'wait': {
        lines.push(`${pad}- wait ${describeWait(n.data.minutes)}`);
        const replied = outEdge(g, id, 'replied'); const next = outEdge(g, id, 'next', 'timeout');
        if (replied) { lines.push(`${pad}  If they reply:`); walk(replied.to, indent + 2); lines.push(`${pad}  If they do not reply:`); walk(next?.to, indent + 2); } else walk(next?.to, indent);
        break;
      }
      case 'branch': {
        const cs = n.data.conditions.map(describeConditionData).join(n.data.match === 'any' ? ' or ' : ' and ');
        lines.push(`${pad}- If ${cs}:`); walk(outEdge(g, id, 'yes')?.to, indent + 1);
        const no = outEdge(g, id, 'no'); if (no) { lines.push(`${pad}  Otherwise:`); walk(no.to, indent + 1); }
        break;
      }
      case 'end': lines.push(`${pad}- stop`); break;
      case 'trigger': break;
    }
  };
  walk(outEdge(g, trigger.id, 'next')?.to, 1);
  return lines;
}

export const automationGraphInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullish(),
  graph: z.unknown(),
  cooldownMinutes: z.number().int().min(0).max(60 * 24 * 30).default(60),
  expectedVersion: z.number().int().min(1).optional(),
});
export const automationValidateSchema = z.object({ graph: z.unknown() });
