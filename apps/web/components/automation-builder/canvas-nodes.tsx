'use client';

import type { GraphIssue, GraphNode } from '@leadpilot/validation';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, Clock, GitBranch, type LucideIcon, MinusCircle, Play, XCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { MarkState, NodeMark } from './canvas-overlay';

export type FlowNodeData = { node: GraphNode; title: string; issues: GraphIssue[]; mark: NodeMark | null; unreached: boolean; readOnly: boolean };
export type FlowNode = Node<FlowNodeData, 'step'>;

export const KIND: Record<GraphNode['type'], { label: string; icon: LucideIcon }> = {
  trigger: { label: 'Trigger', icon: Zap }, action: { label: 'Action', icon: Play }, branch: { label: 'Condition', icon: GitBranch }, wait: { label: 'Wait', icon: Clock }, end: { label: 'Stop', icon: MinusCircle },
};
const MARK_ICON: Record<MarkState, { icon: LucideIcon; tone: string }> = {
  start: { icon: Zap, tone: 'text-primary' }, ran: { icon: CheckCircle2, tone: 'text-success' }, would_run: { icon: CheckCircle2, tone: 'text-success' },
  yes: { icon: CheckCircle2, tone: 'text-success' }, no: { icon: XCircle, tone: 'text-warning' }, skipped: { icon: MinusCircle, tone: 'text-warning' },
  failed: { icon: XCircle, tone: 'text-danger' }, waiting: { icon: Clock, tone: 'text-primary' }, wait_sim: { icon: Clock, tone: 'text-primary' },
};

/** The text a screen reader gets for a step: what it is, what it does, whether it has problems, and what a test or run did there. */
export function nodeAriaLabel(d: FlowNodeData): string {
  const errs = d.issues.filter((i) => i.severity === 'error').length;
  return `${KIND[d.node.type].label}: ${d.title}.${errs ? ` ${errs} problem${errs === 1 ? '' : 's'} to fix.` : ''}${d.mark ? ` ${d.mark.text}.` : d.unreached ? ' Not reached.' : ''}`;
}

const CAPTIONS: Partial<Record<GraphNode['type'], [string, string]>> = { branch: ['If', 'Otherwise'], wait: ['Replied', 'No reply'] };

/** One card for every kind of step. Handles sit on the bottom edge: one for most steps, two (with visible captions) for a condition or a wait. */
export function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const k = KIND[data.node.type]; const Icon = k.icon;
  const errors = data.issues.filter((i) => i.severity === 'error'); const warnings = data.issues.length - errors.length;
  const cap = CAPTIONS[data.node.type]; const two = !!cap;
  const m = data.mark ? MARK_ICON[data.mark.state] : null; const MI = m?.icon;
  const t = data.node.type;
  return (
    <div className={cn('w-[248px] rounded-lg border bg-card text-card-foreground shadow-sm', errors.length ? 'border-danger' : 'border-border-strong', data.unreached && 'border-dashed bg-muted', selected && 'border-primary ring-2 ring-primary')} data-testid={`flow-${t}`}>
      {t !== 'trigger' ? <Handle id="in" type="target" position={Position.Top} className={data.readOnly ? 'lp-readonly' : undefined} /> : null}
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-helper">{k.label}</p>
          <p className="line-clamp-2 break-words text-[13px] font-medium leading-snug">{data.title}</p>
        </div>
        {errors.length ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger"><AlertTriangle className="h-3 w-3" aria-hidden />{errors.length}<span className="sr-only"> problem{errors.length === 1 ? '' : 's'}</span></span> : warnings ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning"><AlertTriangle className="h-3 w-3" aria-hidden />{warnings}<span className="sr-only"> note{warnings === 1 ? '' : 's'}</span></span> : null}
      </div>
      {data.mark && MI ? <p className={cn('mx-3 mt-1.5 flex items-start gap-1.5 text-[12px] font-medium', m?.tone)} data-testid="flow-mark"><MI className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words text-foreground">{data.mark.text}</span></p> : data.unreached ? <p className="mx-3 mt-1.5 text-[12px] text-muted-foreground" data-testid="flow-mark">Not reached</p> : null}
      {two ? (
        <div className="relative mt-2 h-6 text-[11px] font-medium text-muted-foreground">
          <span className="absolute -translate-x-1/2" style={{ left: '30%' }}>{(cap as [string, string])[0]}</span>
          <span className="absolute -translate-x-1/2" style={{ left: '70%' }}>{(cap as [string, string])[1]}</span>
        </div>
      ) : <div className="h-3" />}
      {t === 'branch' ? <>
        <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '30%' }} className={data.readOnly ? 'lp-readonly' : undefined} />
        <Handle id="no" type="source" position={Position.Bottom} style={{ left: '70%' }} className={data.readOnly ? 'lp-readonly' : undefined} />
      </> : t === 'wait' ? <>
        <Handle id="replied" type="source" position={Position.Bottom} style={{ left: '30%' }} className={data.readOnly ? 'lp-readonly' : undefined} />
        <Handle id="next" type="source" position={Position.Bottom} style={{ left: '70%' }} className={data.readOnly ? 'lp-readonly' : undefined} />
      </> : t !== 'end' ? <Handle id="next" type="source" position={Position.Bottom} className={data.readOnly ? 'lp-readonly' : undefined} /> : null}
    </div>
  );
}

export const nodeTypes = { step: StepNode };
