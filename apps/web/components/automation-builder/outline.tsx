'use client';

import { outEdge, type AutomationGraph, type GraphIssue, type GraphNode } from '@leadpilot/validation';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Clock, GitBranch, Info, type LucideIcon, MinusCircle, MoreHorizontal, Play, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { cn } from '@/lib/cn';
import { browserTimers, scheduleStepFocus, snapshotFocus } from '@/lib/focus-request';
import { nodeTitle, slotEdge, slotLabel, slotsOf, triggerOf, type Slot } from '@/lib/automation-graph-state';
import type { DryRunPathItem } from '@/lib/ops';

/**
 * The Outline is the accessible, keyboard-first editor of the graph (and the editor on phones): every path is a nested list, every step a
 * button, every structural edit a menu item or button. It has FULL parity with the canvas (milestone 3): anything you can do by dragging
 * you can do here, so nobody is ever forced to use a pointer.
 */
export type AddKind = 'action' | 'branch' | 'wait';
export interface OutlineProps {
  graph: AutomationGraph;
  selected: string | null;
  issues: GraphIssue[];
  /** Dry-run result per step, shown beside each step so the path taken is visible (icon + words, not colour alone). */
  overlay: Map<string, DryRunPathItem> | null;
  focus: string | null;
  onFocused: () => void;
  onEdit: (id: string) => void;
  onInsert: (parentId: string, slot: Slot, kind: AddKind) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onConnect: (from: string, slot: Slot, to: string | null) => void;
}

const KIND: Record<GraphNode['type'], { label: string; icon: LucideIcon }> = {
  trigger: { label: 'Trigger', icon: Zap }, action: { label: 'Action', icon: Play }, branch: { label: 'If / otherwise', icon: GitBranch }, wait: { label: 'Wait', icon: Clock }, end: { label: 'Stop', icon: MinusCircle },
};
const OUTCOME: Record<DryRunPathItem['outcome'], { text: string; icon: LucideIcon; tone: string }> = {
  yes: { text: 'Test: condition met, takes the If path', icon: CheckCircle2, tone: 'text-success' },
  no: { text: 'Test: condition not met, takes Otherwise', icon: XCircle, tone: 'text-warning' },
  would_run: { text: 'Test: would run', icon: CheckCircle2, tone: 'text-success' },
  would_wait: { text: 'Test: would wait', icon: Clock, tone: 'text-primary' },
  skipped: { text: 'Test: would be skipped', icon: MinusCircle, tone: 'text-warning' },
};
export const describeMinutes = (m: number): string => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`);

function AddButtons({ parent, slot, context, onInsert }: { parent: string; slot: Slot; context: string; onInsert: OutlineProps['onInsert'] }) {
  const kinds: [AddKind, string][] = [['action', 'Add action'], ['branch', 'Add condition'], ['wait', 'Add wait']];
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Add a step ${context}`}>
      {kinds.map(([k, label]) => <Button key={k} size="sm" className="max-lg:min-h-11" onClick={() => onInsert(parent, slot, k)} aria-label={`${label} ${context}`}><Plus className="h-3.5 w-3.5" aria-hidden />{label}</Button>)}
    </div>
  );
}

export function Outline(p: OutlineProps) {
  const root = useRef<HTMLOListElement>(null);
  const { focus, onFocused } = p;

  // Move focus to a step after an edit. Menus hand focus back to their trigger on close, so check once more after they are gone;
  // the late check only undoes that hand-back and never takes focus from anything the user chose meanwhile (lib/focus-request.ts).
  useEffect(() => {
    if (!focus) return;
    const origin = document.activeElement;   // where focus is when the request is made: if the user moves it elsewhere, the request is stale
    return scheduleStepFocus({
      find: () => root.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(focus)}"]`) ?? null,
      snapshot: (target) => snapshotFocus(target, origin), focus: (el) => el.focus(), done: onFocused, timers: browserTimers, firstMs: 0, lateMs: 260,
    });
  }, [focus, onFocused]);

  const byId = new Map(p.graph.nodes.map((n) => [n.id, n]));
  const issuesFor = (id: string) => p.issues.filter((i) => i.nodeId === id);
  const rendered = new Set<string>();
  let counter = 0;
  const stepNo = new Map<string, number>();

  const targetOf = (id: string, slot: Slot): string | undefined => slotEdge(p.graph, id, slot)?.to;

  const renderCard = (n: GraphNode): ReactNode => {
    const k = KIND[n.type]; const Icon = k.icon; const sel = p.selected === n.id;
    const no = stepNo.get(n.id); const issues = issuesFor(n.id); const ov = p.overlay?.get(n.id);
    const title = nodeTitle(n);
    const issueId = `issues-${n.id}`;
    const insertItems = (n.type === 'trigger' || n.type === 'action' || n.type === 'wait') ? (
      <>
        <DropdownItem onSelect={() => { p.onInsert(n.id, 'next', 'action'); }}>Add an action after</DropdownItem>
        <DropdownItem onSelect={() => { p.onInsert(n.id, 'next', 'branch'); }}>Add a condition (if / otherwise) after</DropdownItem>
        <DropdownItem onSelect={() => { p.onInsert(n.id, 'next', 'wait'); }}>Add a wait after</DropdownItem>
      </>
    ) : null;
    const hasReplied = n.type === 'wait' && !!outEdge(p.graph, n.id, 'replied');
    return (
      <div className={cn('rounded-lg border bg-card', sel ? 'border-primary ring-1 ring-primary' : 'border-border')} data-testid={`step-${n.type}`}>
        <div className="flex items-stretch gap-1">
          <button type="button" data-step={n.id} aria-current={sel ? 'true' : undefined} aria-describedby={issues.length ? issueId : undefined} onClick={() => p.onEdit(n.id)}
            className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0"><span className="text-helper block">{n.type === 'trigger' ? k.label : `Step ${no} · ${k.label}`}</span><span className="block break-words text-[13px] font-medium">{title}</span></span>
          </button>
          <Dropdown onCloseAutoFocus={(e) => { if (p.focus) e.preventDefault(); }} trigger={<Button type="button" variant="ghost" size="icon" className="m-0.5 max-lg:h-11 max-lg:w-11" aria-label={`Actions for ${n.type === 'trigger' ? 'the trigger' : `step ${no}`}: ${title}`}><MoreHorizontal className="h-4 w-4" aria-hidden /></Button>}>
            {insertItems}
            {n.type === 'wait' ? (hasReplied
              ? <DropdownItem onSelect={() => { p.onConnect(n.id, 'replied', null); }}>Remove the &quot;if they reply&quot; path</DropdownItem>
              : <DropdownItem onSelect={() => { p.onInsert(n.id, 'replied', 'action'); }}>Add an &quot;if they reply&quot; path</DropdownItem>) : null}
            {n.type === 'action' || n.type === 'wait' ? <>
              <DropdownSeparator />
              <DropdownItem onSelect={() => { p.onMove(n.id, 'up'); }}><ArrowUp className="h-3.5 w-3.5" aria-hidden />Move up</DropdownItem>
              <DropdownItem onSelect={() => { p.onMove(n.id, 'down'); }}><ArrowDown className="h-3.5 w-3.5" aria-hidden />Move down</DropdownItem>
            </> : null}
            {n.type !== 'trigger' ? <>
              <DropdownSeparator />
              <DropdownItem danger onSelect={() => { p.onRemove(n.id); }}><Trash2 className="h-3.5 w-3.5" aria-hidden />{n.type === 'branch' ? 'Delete (keeps the If path)' : 'Delete step'}</DropdownItem>
            </> : null}
          </Dropdown>
        </div>
        {ov ? (() => { const o = OUTCOME[ov.outcome]; const OI = o.icon; return (
          <div className={cn('flex items-start gap-2 border-t border-border px-3 py-1.5 text-[12px]', o.tone)} data-testid="overlay"><OI className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><div className="min-w-0 text-foreground"><span className={cn('font-medium', o.tone)}>{o.text}</span>{ov.type === 'wait' && ov.wouldWaitMinutes ? ` ${describeMinutes(ov.wouldWaitMinutes)}` : ''}{ov.detail && ov.type !== 'wait' && ov.type !== 'branch' ? <span className="block break-words text-muted-foreground">{ov.detail}</span> : null}
            {ov.conditions?.length ? <ul className="mt-0.5">{ov.conditions.map((c, i) => <li key={i} className="flex items-center gap-1.5">{c.pass ? <CheckCircle2 className="h-3 w-3 text-success" aria-label="met" /> : <XCircle className="h-3 w-3 text-warning" aria-label="not met" />}<span>{c.text}</span></li>)}</ul> : null}</div></div>); })() : null}
        {issues.length ? (
          <ul id={issueId} className="space-y-0.5 border-t border-border px-3 py-1.5 text-[12px]">
            {issues.map((i, ix) => <li key={ix} className={cn('flex items-start gap-1.5', i.severity === 'error' ? 'text-danger' : 'text-warning')}>{i.severity === 'error' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}<span><span className="font-medium">{i.severity === 'error' ? 'Problem: ' : 'Heads up: '}</span>{i.message}</span></li>)}
          </ul>
        ) : null}
      </div>
    );
  };

  /** A path: one list item per step, following "straight on" connections; branches and replied-waits nest their own paths. */
  function chain(startId: string | undefined): ReactNode[] {
    const items: ReactNode[] = [];
    let cur = startId; let last: { id: string; slot: Slot } | null = null;
    while (cur) {
      const n = byId.get(cur); if (!n) break;
      if (rendered.has(cur)) {
        items.push(
          <li key={`ref-${cur}-${items.length}`} className="rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">
            Continues with the step &quot;{nodeTitle(n)}&quot; shown above.{' '}
            <button type="button" className="min-h-8 font-medium text-primary underline underline-offset-2 hover:no-underline max-lg:min-h-11" onClick={() => root.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(cur as string)}"]`)?.focus()}>Go to that step</button>
          </li>,
        );
        last = null; break;
      }
      rendered.add(cur);
      if (n.type !== 'trigger') stepNo.set(n.id, ++counter);
      const slots = slotsOf(n, p.graph);
      const multi = n.type === 'branch' || (n.type === 'wait' && slots.includes('replied'));
      items.push(
        <li key={n.id} data-node={n.id}>
          {renderCard(n)}
          {multi ? (
            <ul className="mt-2 ml-3 space-y-3 border-l-2 border-border pl-3 sm:ml-5">
              {slots.map((slot) => {
                const label = slotLabel(n, slot); const t = targetOf(n.id, slot);
                return (
                  <li key={slot}>
                    <h3 className="text-label mb-1.5 text-muted-foreground">{label}</h3>
                    <ol className="space-y-2" aria-label={`Steps for: ${label}`}>
                      {t ? chain(t) : <li><AddButtons parent={n.id} slot={slot} context={`to the "${label}" path`} onInsert={p.onInsert} /></li>}
                    </ol>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </li>,
      );
      if (multi) { last = null; break; }
      const next = n.type === 'wait' ? outEdge(p.graph, n.id, 'next', 'timeout') : outEdge(p.graph, n.id, 'next');
      if (!next) { last = { id: n.id, slot: 'next' }; break; }
      cur = next.to; last = null;
    }
    if (last) {
      const owner = byId.get(last.id);
      items.push(<li key={`add-${last.id}-${last.slot}`}><AddButtons parent={last.id} slot={last.slot} context={owner ? `after: ${nodeTitle(owner)}` : 'here'} onInsert={p.onInsert} /></li>);
    }
    return items;
  }

  const t = triggerOf(p.graph);
  const list = t ? chain(t.id) : [];
  // A graph from the server can contain steps nothing leads to (the editor itself never creates them). Show them so they can be fixed or deleted.
  const orphans = p.graph.nodes.filter((n) => !rendered.has(n.id));
  for (const n of orphans) stepNo.set(n.id, ++counter);
  return (
    <>
      <ol ref={root} className="space-y-2" aria-label="Automation steps" data-testid="outline">{list}</ol>
      {orphans.length ? (
        <section className="mt-4 rounded-lg border border-dashed border-danger/50 p-3" aria-label="Steps not connected to the trigger">
          <h3 className="text-label mb-2 text-danger">Not connected to the trigger (these never run)</h3>
          <ol className="space-y-2">{orphans.map((n) => <li key={n.id}>{renderCard(n)}</li>)}</ol>
        </section>
      ) : null}
    </>
  );
}
