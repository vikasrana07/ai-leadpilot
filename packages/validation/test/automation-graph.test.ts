import { describe, expect, it } from 'vitest';
import { effectiveGraph, graphErrors, graphToLinear, GRAPH_LIMITS, linearToGraph, summarizeGraph, validateGraph, type AutomationGraph } from '../src/automation-graph.js';

const trigger = { type: 'lead.created' } as const;
const msg = { type: 'send_message', text: 'Hello {{lead.firstName}}' } as const;
const tag = { type: 'add_tag', tag: 'vip' } as const;
const cond = { field: 'lead.temperature', op: 'eq', value: 'HOT' } as const;
const codes = (g: unknown) => validateGraph(g).map((i) => `${i.severity}:${i.code}`);
const errs = (g: unknown) => graphErrors(validateGraph(g)).map((i) => i.code);

const branching = (): AutomationGraph => ({
  v: 1,
  nodes: [
    { id: 't', type: 'trigger', data: trigger },
    { id: 'b', type: 'branch', data: { match: 'any', conditions: [cond, { field: 'lead.score', op: 'gte', value: 80 }] } },
    { id: 'a1', type: 'action', data: msg },
    { id: 'w', type: 'wait', data: { minutes: 1440, exitOnOptOut: true } },
    { id: 'a2', type: 'action', data: tag },
  ],
  edges: [
    { id: 'e1', from: 't', to: 'b', label: 'next' }, { id: 'e2', from: 'b', to: 'a1', label: 'yes' }, { id: 'e3', from: 'b', to: 'w', label: 'no' },
    { id: 'e4', from: 'w', to: 'a2', label: 'timeout' },
  ],
});

describe('validateGraph', () => {
  it('accepts a branching graph with a wait; open sides are warnings only', () => {
    expect(errs(branching())).toEqual([]);
    const open = branching(); open.edges = open.edges.filter((e) => e.id !== 'e2');
    expect(codes(open)).toContain('warning:branch_open');
  });
  it('rejects shapes that are not graphs and oversize input', () => {
    expect(errs(null)).toContain('schema'); expect(errs({ v: 2, nodes: [], edges: [] })).toContain('schema');
    const big = branching(); big.nodes.push({ id: 'x', type: 'action', data: { type: 'send_message', text: 'x'.repeat(900) } });
    expect(errs({ ...big, pad: 'y'.repeat(GRAPH_LIMITS.bytes) })).toEqual(['too_large']);
  });
  it('requires exactly one trigger, no incoming edge to it, and at least one action', () => {
    const none = branching(); none.nodes = none.nodes.filter((n) => n.type !== 'trigger'); none.edges = none.edges.filter((e) => e.from !== 't');
    expect(errs(none)).toContain('trigger_count');
    const two = branching(); two.nodes.push({ id: 't2', type: 'trigger', data: trigger }); expect(errs(two)).toContain('trigger_count');
    const back = branching(); back.edges.push({ id: 'eb', from: 'a2', to: 't', label: 'next' }); expect(errs(back)).toContain('trigger_incoming');
    expect(errs({ v: 1, nodes: [{ id: 't', type: 'trigger', data: trigger }], edges: [] })).toEqual(expect.arrayContaining(['trigger_empty', 'no_actions']));
  });
  it('rejects cycles, unreachable nodes, dangling edges, wrong labels and duplicate labels', () => {
    const cyc = branching(); cyc.edges.push({ id: 'ec', from: 'a2', to: 'w', label: 'next' }); expect(errs(cyc)).toContain('cycle');
    const orphan = branching(); orphan.nodes.push({ id: 'o', type: 'action', data: tag }); expect(errs(orphan)).toContain('unreachable');
    const dangling = branching(); dangling.edges.push({ id: 'ed', from: 'a1', to: 'nope', label: 'next' }); expect(errs(dangling)).toContain('edge_ref');
    const wrong = branching(); wrong.edges.push({ id: 'ew', from: 'a1', to: 'a2', label: 'yes' }); expect(errs(wrong)).toContain('edge_label');
    const dup = branching(); dup.edges.push({ id: 'ed2', from: 'b', to: 'a2', label: 'yes' }); expect(errs(dup)).toContain('edge_duplicate_label');
    const self = branching(); self.edges.push({ id: 'es', from: 'a1', to: 'a1', label: 'next' }); expect(errs(self)).toContain('self_loop');
    const both = branching(); both.edges.push({ id: 'e5', from: 'w', to: 'a1', label: 'next' }); expect(errs(both)).toContain('wait_edges');
  });
  it('enforces node, action, depth and wait limits', () => {
    const chain = (n: number, mk: (i: number) => AutomationGraph['nodes'][number]): AutomationGraph => {
      const nodes = [{ id: 't', type: 'trigger', data: trigger } as AutomationGraph['nodes'][number], ...Array.from({ length: n }, (_, i) => mk(i))];
      return { v: 1, nodes, edges: nodes.slice(1).map((nd, i) => ({ id: `e${i}`, from: nodes[i]!.id, to: nd.id, label: 'next' as const })) };
    };
    expect(errs(chain(GRAPH_LIMITS.nodes, (i) => ({ id: `a${i}`, type: 'action', data: tag })))).toContain('schema'); // 26 nodes
    expect(errs(chain(13, (i) => ({ id: `a${i}`, type: 'action', data: tag })))).toEqual(expect.arrayContaining(['too_many_actions']));
    expect(errs(chain(4, (i) => ({ id: `w${i}`, type: 'wait', data: { minutes: 5, exitOnOptOut: true } })))).toEqual(expect.arrayContaining(['too_many_waits']));
    expect(errs(chain(13, (i) => ({ id: `a${i}`, type: 'action', data: tag })))).toEqual(expect.arrayContaining(['too_deep']));
    expect(errs({ v: 1, nodes: [{ id: 't', type: 'trigger', data: trigger }, { id: 'w', type: 'wait', data: { minutes: GRAPH_LIMITS.waitMinutes + 1 } }], edges: [] })).toContain('schema');
  });
  it('validates trigger config, conditions and action fields through the shared schemas', () => {
    const g = branching(); g.nodes[0] = { id: 't', type: 'trigger', data: { type: 'lead.inactive' } as never }; expect(errs(g)).toContain('schema');
    const b = branching(); (b.nodes[1] as { data: { conditions: unknown[] } }).data.conditions = []; expect(errs(b)).toContain('schema');
  });
});

describe('linear conversion', () => {
  it('is lossless in both directions, with and without conditions', () => {
    for (const conditions of [[], [cond]]) {
      const lin = { trigger, conditions: [...conditions], actions: [msg, tag] };
      const g = linearToGraph(lin as never);
      expect(errs(g)).toEqual([]);
      expect(graphToLinear(g)).toEqual(lin);
    }
  });
  it('refuses to flatten graphs that branch or wait, and effectiveGraph prefers a stored graph', () => {
    expect(graphToLinear(branching())).toBeNull();
    const row = { trigger, conditions: [], actions: [msg] };
    expect(effectiveGraph(row).nodes.map((n) => n.id)).toEqual(['t', 'a1']);
    expect(effectiveGraph({ ...row, graph: branching() }).nodes).toHaveLength(5);
  });
});

describe('summarizeGraph', () => {
  it('reads as plain English with branches and waits', () => {
    const text = summarizeGraph(branching()).join('\n');
    expect(text).toContain('When a lead is created:'); expect(text).toContain('If temperature is HOT or score is at least 80:');
    expect(text).toContain('Otherwise:'); expect(text).toContain('wait 1 day'); expect(text).toContain('add the tag "vip"');
  });
  it('keeps the original wording by default and follows the industry words when given', () => {
    const g = branching(); g.nodes[2] = { id: 'a1', type: 'action', data: { type: 'assign_round_robin' } };
    const plain = summarizeGraph(g).join('\n');
    expect(plain).toContain('When a lead is created:'); expect(plain).toContain('assign the lead to the least busy agent');
    expect(summarizeGraph(g, { lead: 'lead', appointment: 'appointment' }).join('\n')).toBe(plain);
    const coaching = summarizeGraph(g, { lead: 'enquiry', appointment: 'demo class' }).join('\n');
    expect(coaching).toContain('When an enquiry is created:'); expect(coaching).toContain('assign the enquiry to the least busy agent');
    const appt = summarizeGraph({ v: 1, nodes: [{ id: 't', type: 'trigger', data: { type: 'appointment.upcoming', hoursBefore: 24 } }, { id: 'a', type: 'action', data: { type: 'notify', target: 'lead_owner', title: 'Hi' } }], edges: [{ id: 'e', from: 't', to: 'a', label: 'next' }] }, { lead: 'customer', appointment: 'inspection' }).join('\n');
    expect(appt).toContain('When an inspection is coming up (24h before):'); expect(appt).toContain('notify the customer owner: "Hi"');
  });
  it('shows replied / not replied paths for a wait', () => {
    const g = branching(); g.edges.push({ id: 'er', from: 'w', to: 'a1', label: 'replied' });
    expect(summarizeGraph(g).join('\n')).toContain('If they reply:');
  });
});
