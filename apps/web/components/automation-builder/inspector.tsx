'use client';

import { outEdge, type AutomationGraph, type GraphIssue, type GraphNode } from '@leadpilot/validation';
import { AlertTriangle, Info, Trash2 } from 'lucide-react';
import { forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { nodeTitle, slotLabel, slotsOf, slotEdge, validTargets, type Slot } from '@/lib/automation-graph-state';
import { ActionForm, BranchForm, TriggerForm, WaitForm } from './node-forms';

const KIND_LABEL: Record<GraphNode['type'], string> = { trigger: 'trigger', action: 'action', branch: 'condition (if / otherwise)', wait: 'wait', end: 'stop' };

export interface InspectorProps {
  graph: AutomationGraph;
  node: GraphNode;
  issues: GraphIssue[];
  onApply: (id: string, data: GraphNode['data']) => void;
  onConnect: (from: string, slot: Slot, to: string | null) => void;
  onAddReply: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: (id: string) => void;
}

/** Settings of the selected step plus its connections ("what happens next"), which is the keyboard equivalent of dragging a line on the canvas. */
export const Inspector = forwardRef<HTMLHeadingElement, InspectorProps>(function Inspector({ graph, node, issues, onApply, onConnect, onAddReply, onRemove, onClose }, headingRef) {
  const slots: Slot[] = slotsOf(node, graph);
  return (
    <div data-testid="inspector">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-heading outline-none">Edit {KIND_LABEL[node.type]}</h2>
        <Button type="button" size="sm" className="max-lg:min-h-11" onClick={() => onClose(node.id)}>Done</Button>
      </div>
      <p className="text-helper mb-3 break-words">{nodeTitle(node)}</p>
      {issues.length ? (
        <ul className="mb-3 space-y-1 rounded-md border border-border bg-muted/40 p-2 text-[12px]">
          {issues.map((i, ix) => <li key={ix} className={i.severity === 'error' ? 'flex gap-1.5 text-danger' : 'flex gap-1.5 text-warning'}>{i.severity === 'error' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}<span><span className="font-medium">{i.severity === 'error' ? 'Problem: ' : 'Heads up: '}</span>{i.message}</span></li>)}
        </ul>
      ) : null}

      <div key={node.id}>
        {node.type === 'trigger' ? <TriggerForm data={node.data} onApply={(d) => onApply(node.id, d)} /> : null}
        {node.type === 'action' ? <ActionForm data={node.data} onApply={(d) => onApply(node.id, d)} /> : null}
        {node.type === 'branch' ? <BranchForm data={node.data} onApply={(d) => onApply(node.id, d)} /> : null}
        {node.type === 'wait' ? <WaitForm data={node.data} onApply={(d) => onApply(node.id, d)} /> : null}
      </div>

      {slots.length ? (
        <section className="mt-5 border-t border-border pt-4" aria-labelledby={`conn-${node.id}`}>
          <h3 id={`conn-${node.id}`} className="text-label mb-1 text-foreground">What happens next</h3>
          <p className="text-helper mb-3">Choose where each path continues. Pick an earlier or parallel step to join two paths. Steps can never loop back.</p>
          <div className="space-y-3">
            {slots.map((slot) => {
              const cur = slotEdge(graph, node.id, slot)?.to ?? '';
              const targets = validTargets(graph, node.id, slot);
              const hasCur = !cur || targets.some((t) => t.id === cur);
              const curNode = graph.nodes.find((n) => n.id === cur);
              return (
                <Field key={slot} label={slotLabel(node, slot)} htmlFor={`next-${node.id}-${slot}`}>
                  <Select id={`next-${node.id}-${slot}`} value={cur} onChange={(e) => onConnect(node.id, slot, e.target.value === '' ? null : e.target.value)}>
                    <option value="">Nothing: the automation stops here</option>
                    {!hasCur && curNode ? <option value={cur}>{nodeTitle(curNode)}</option> : null}
                    {targets.map((t) => <option key={t.id} value={t.id}>{nodeTitle(t).slice(0, 80)}</option>)}
                  </Select>
                </Field>
              );
            })}
          </div>
          {node.type === 'wait' ? (outEdge(graph, node.id, 'replied')
            ? <Button type="button" size="sm" className="mt-3 max-lg:min-h-11" onClick={() => onConnect(node.id, 'replied', null)}>Remove the &quot;if they reply&quot; path</Button>
            : <Button type="button" size="sm" className="mt-3 max-lg:min-h-11" onClick={() => onAddReply(node.id)}>Add an &quot;if they reply&quot; path</Button>) : null}
        </section>
      ) : null}

      {node.type !== 'trigger' ? <div className="mt-5 border-t border-border pt-4"><Button type="button" variant="danger" size="sm" className="max-lg:min-h-11" onClick={() => onRemove(node.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete this step</Button></div> : null}
    </div>
  );
});
