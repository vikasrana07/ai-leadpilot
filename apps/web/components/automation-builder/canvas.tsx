'use client';

import '@xyflow/react/dist/style.css';
import './canvas.css';
import { type AutomationGraph, type GraphIssue } from '@leadpilot/validation';
import {
  Background, Controls, type Edge, type FinalConnectionState, MarkerType, MiniMap, type NodeChange, ReactFlow, ReactFlowProvider, useReactFlow,
} from '@xyflow/react';
import { Clock, GitBranch, LayoutGrid, Maximize2, Play, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useMediaQuery } from '@/hooks/use-media-query';
import { nodeById, nodeTitle, validTargets, type Slot } from '@/lib/automation-graph-state';
import { layoutGraph, type Positions } from '@/lib/automation-layout';
import { useTheme } from '@/lib/theme';
import { addSlotFor, neighborOf } from './canvas-nav';
import { nodeAriaLabel, nodeTypes, type FlowNode, type FlowNodeData } from './canvas-nodes';
import type { NodeMark } from './canvas-overlay';
import type { AddKind } from './outline';

export interface CanvasProps {
  graph: AutomationGraph;
  selected: string | null;
  issues: GraphIssue[];
  /** What a test or a past run did at each step (null = no overlay). */
  marks: Map<string, NodeMark> | null;
  taken: Set<string> | null;
  /** Phones and the run viewer: look, pan, zoom and open a step, but no dragging, connecting or deleting. */
  readOnly: boolean;
  summaryText: string;
  focus: string | null;
  onFocused: () => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string) => void;
  onInsert: (parentId: string, slot: Slot, kind: AddKind) => void;
  onRemove: (id: string) => void;
  onConnect: (from: string, slot: Slot, to: string | null) => void;
  onPositions: (p: Positions) => void;
  onTidy: () => void;
  children?: ReactNode;
}

const EDGE_TEXT: Record<string, string> = { yes: 'Yes', no: 'No', replied: 'Replied', timeout: 'No reply' };
const COLORS = { light: { edge: '#5b6578', taken: '#3f55e8', map: '#8a93a6', mask: 'rgba(15,22,35,0.12)' }, dark: { edge: '#9099ad', taken: '#6b7cff', map: '#5b6578', mask: 'rgba(0,0,0,0.45)' } } as const;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function CanvasInner(p: CanvasProps) {
  const { resolved } = useTheme();
  const c = COLORS[resolved === 'dark' ? 'dark' : 'light'];
  const { fitView } = useReactFlow();
  const wide = useMediaQuery('(min-width: 1024px)');
  const host = useRef<HTMLDivElement>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [pending, setPending] = useState<{ nodes: string[]; edges: { from: string; slot: Slot }[] } | null>(null);
  const { graph, readOnly, marks, taken } = p;

  const auto = useMemo(() => layoutGraph(graph), [graph]);
  const derived = useMemo<FlowNode[]>(() => graph.nodes.map((n) => {
    const data: FlowNodeData = { node: n, title: nodeTitle(n), issues: p.issues.filter((i) => i.nodeId === n.id), mark: marks?.get(n.id) ?? null, unreached: !!marks && marks.size > 0 && !marks.has(n.id), readOnly };
    return { id: n.id, type: 'step', position: n.pos ?? (auto[n.id] as { x: number; y: number }), data, selected: p.selected === n.id, draggable: !readOnly, connectable: !readOnly, deletable: !readOnly && n.type !== 'trigger', ariaLabel: nodeAriaLabel(data), focusable: true };
  }), [graph, p.issues, p.selected, marks, readOnly, auto]);

  // React Flow measures nodes and tracks a drag in progress; those two bits live here, everything else (what exists, where it is saved, what is
  // selected) is derived from the editor's graph, which stays the only source of truth.
  const [measure, setMeasure] = useState<Record<string, { width: number; height: number }>>({});
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  // `measured` only: an explicit width/height would freeze a card at its old size when a badge appears on it.
  const nodes = useMemo<FlowNode[]>(() => derived.map((d) => { const m = measure[d.id]; return { ...d, ...(m ? { measured: m } : {}), position: dragging[d.id] ?? d.position }; }), [derived, measure, dragging]);
  const onNodesChange = useCallback((ch: NodeChange<FlowNode>[]) => {
    for (const c of ch) {
      if (c.type === 'dimensions' && c.dimensions) { const d = c.dimensions; setMeasure((m) => (m[c.id]?.width === d.width && m[c.id]?.height === d.height ? m : { ...m, [c.id]: { width: d.width, height: d.height } })); }
      else if (c.type === 'position' && c.position && c.dragging) { const pos = c.position; setDragging((m) => ({ ...m, [c.id]: pos })); }
    }
  }, []);

  const edges = useMemo<Edge[]>(() => graph.edges.map((e) => {
    const from = nodeById(graph, e.from);
    const hasReplied = from?.type === 'wait' && graph.edges.some((x) => x.from === e.from && x.label === 'replied');
    const text = EDGE_TEXT[e.label] ?? (hasReplied && e.label === 'next' ? 'No reply' : undefined);
    const isTaken = !!taken?.has(e.id); const faded = !!taken && taken.size > 0 && !isTaken;
    const color = isTaken ? c.taken : c.edge;
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: e.label === 'timeout' ? 'next' : e.label, targetHandle: 'in', type: 'smoothstep', selected: selectedEdge === e.id, focusable: false, interactionWidth: 24,
      deletable: !readOnly, ...(text ? { label: isTaken ? `${text} ✓` : text } : isTaken ? { label: '✓' } : {}),
      labelStyle: { fill: 'var(--foreground)', fontWeight: 600, fontSize: 12 }, labelBgStyle: { fill: 'var(--card)', stroke: 'var(--border-strong)' }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4,
      style: { stroke: color, strokeWidth: isTaken ? 3.5 : 1.75, ...(faded ? { strokeDasharray: '6 5' } : {}) }, markerEnd: { type: MarkerType.ArrowClosed, color },
      ariaLabel: `Connection from ${from ? nodeTitle(from) : e.from} to ${nodeTitle(nodeById(graph, e.to) ?? { id: e.to, type: 'end', data: {} } as never)}${text ? ` (${text})` : ''}${isTaken ? ', taken' : ''}`,
    };
  }), [graph, taken, selectedEdge, readOnly, c]);

  // ---- focus a step after it was added (the Outline does the same with its own buttons)
  const { focus, onFocused } = p;
  useEffect(() => {
    if (!focus) return;
    const find = () => host.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(focus)}"]`) ?? null;
    const t1 = window.setTimeout(() => find()?.focus(), 60);
    const t2 = window.setTimeout(() => { const el = find(); if (el && document.activeElement !== el) el.focus(); onFocused(); }, 320);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [focus, onFocused]);

  // ---- show everything once, and again after Tidy or when the shape changes a lot
  const fitKey = `${graph.nodes.length}`;
  useEffect(() => { const t = window.setTimeout(() => void fitView({ padding: 0.2, duration: reducedMotion() ? 0 : 200, maxZoom: 1 }), 80); return () => window.clearTimeout(t); }, [fitKey, fitView, auto, wide]);

  // ---- connecting: handles carry the path ("yes", "no", "replied", "next"); refusals (loops, the trigger) are explained by the editor's notice
  const slotOf = (h: string | null | undefined): Slot => (h === 'yes' || h === 'no' || h === 'replied' || h === 'next' ? h : 'next');
  const isValid = useCallback((cn: { source: string; target: string; sourceHandle?: string | null }) => validTargets(graph, cn.source, slotOf(cn.sourceHandle)).some((n) => n.id === cn.target), [graph]);
  const onConnectEnd = useCallback((_: unknown, st: FinalConnectionState) => {
    if (st.isValid === false && st.fromNode && st.toNode && st.fromHandle) p.onConnect(st.fromNode.id, slotOf(st.fromHandle.id), st.toNode.id); // the editor refuses and says why
  }, [p]);

  // ---- delete: connections go at once (undoable), steps ask first
  const onBeforeDelete = useCallback(async ({ nodes: ns, edges: es }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
    if (readOnly) return false;
    const ids = ns.map((n) => n.id).filter((id) => nodeById(graph, id)?.type !== 'trigger');
    const lone = es.filter((e) => !ns.some((n) => n.id === graph.edges.find((x) => x.id === e.id)?.from || n.id === graph.edges.find((x) => x.id === e.id)?.to)).flatMap((e) => { const x = graph.edges.find((y) => y.id === e.id); return x ? [{ from: x.from, slot: (x.label === 'timeout' ? 'next' : x.label) as Slot }] : []; });
    if (ids.length) setPending({ nodes: ids, edges: [] });
    else for (const x of lone) p.onConnect(x.from, x.slot, null);
    setSelectedEdge(null);
    return false; // the editor changes the graph, then the canvas redraws from it
  }, [graph, readOnly, p]);

  const deleteSelected = () => {
    if (selectedEdge) { const x = graph.edges.find((e) => e.id === selectedEdge); if (x) { p.onConnect(x.from, (x.label === 'timeout' ? 'next' : x.label) as Slot, null); setSelectedEdge(null); } return; }
    const n = p.selected ? nodeById(graph, p.selected) : undefined;
    if (n && n.type !== 'trigger') setPending({ nodes: [n.id], edges: [] });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!el.classList?.contains('react-flow__node')) return;
    const id = el.getAttribute('data-id'); if (!id) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onEdit(id); return; }
    if (e.key === 'Escape') { p.onSelect(null); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const to = neighborOf(graph, { ...auto, ...Object.fromEntries(graph.nodes.filter((n) => n.pos).map((n) => [n.id, n.pos as { x: number; y: number }])) }, id, e.key);
      if (to) { p.onSelect(to); host.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(to)}"]`)?.focus(); }
    }
  };

  const target = addSlotFor(graph, p.selected);
  const add = (kind: AddKind) => { if (target) p.onInsert(target.parent, target.slot, kind); };
  const selectedNode = p.selected ? nodeById(graph, p.selected) : undefined;
  const canDelete = !readOnly && ((!!selectedNode && selectedNode.type !== 'trigger') || !!selectedEdge);

  return (
    <section aria-label="Automation canvas" data-testid="canvas">
      {!readOnly ? (
        <div className="mb-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Canvas tools">
          <Button size="sm" onClick={() => add('action')} aria-label="Add action after the selected step"><Play className="h-3.5 w-3.5" aria-hidden />Add action</Button>
          <Button size="sm" onClick={() => add('branch')} aria-label="Add condition after the selected step"><GitBranch className="h-3.5 w-3.5" aria-hidden />Add condition</Button>
          <Button size="sm" onClick={() => add('wait')} aria-label="Add wait after the selected step"><Clock className="h-3.5 w-3.5" aria-hidden />Add wait</Button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <Button size="sm" onClick={p.onTidy} aria-label="Tidy: arrange all steps"><LayoutGrid className="h-3.5 w-3.5" aria-hidden />Tidy</Button>
          <Button size="sm" onClick={() => void fitView({ padding: 0.2, duration: reducedMotion() ? 0 : 200, maxZoom: 1 })} aria-label="Fit everything in view"><Maximize2 className="h-3.5 w-3.5" aria-hidden />Fit</Button>
          <Button size="sm" disabled={!canDelete} onClick={deleteSelected} aria-label="Delete the selected step or connection"><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</Button>
        </div>
      ) : null}
      <p className="text-helper mb-2">{readOnly ? 'View only here: pan, zoom and tap a step to see its settings. Switch to the Outline to edit.' : 'Drag from a round handle at the bottom of a step to the round handle at the top of another step to connect them. Click a step or a connection, then press Delete to remove it. Prefer the keyboard? The Outline view does everything the canvas does.'}</p>
      {p.children}
      <p id="canvas-help" className="sr-only">
        {readOnly ? 'Read-only view. Use the Outline view to edit.' : 'Press Tab to reach a step. Enter opens its settings. Arrow keys move to the connected step. Delete removes the selected step after you confirm. The Outline view can do everything this canvas can, including connecting steps.'}
      </p>
      <div ref={host} className="lp-flow h-[min(68dvh,640px)] min-h-[380px] overflow-hidden rounded-lg border border-border-strong" role="group" aria-label={`Automation canvas. ${p.summaryText}`} aria-describedby="canvas-help" onKeyDown={onKeyDown} data-testid="canvas-surface">
        <ReactFlow<FlowNode>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={resolved === 'dark' ? 'dark' : 'light'}
          onNodesChange={onNodesChange} onNodeClick={(_, n) => { setSelectedEdge(null); p.onSelect(n.id); }} onEdgeClick={(_, e) => { if (!readOnly) { setSelectedEdge(e.id); p.onSelect(null); } }} onPaneClick={() => { setSelectedEdge(null); p.onSelect(null); }}
          onNodeDragStop={(_, node, dragged) => { p.onPositions(Object.fromEntries((dragged.length ? dragged : [node]).map((n) => [n.id, n.position]))); setDragging({}); }}
          onConnect={(cn) => p.onConnect(cn.source, slotOf(cn.sourceHandle), cn.target)} onConnectEnd={onConnectEnd} isValidConnection={isValid} onBeforeDelete={onBeforeDelete}
          nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} disableKeyboardA11y nodesFocusable
          selectNodesOnDrag={false} zoomOnDoubleClick={false} minZoom={0.25} maxZoom={1.75} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} proOptions={{ hideAttribution: false }}
        >
          <Background gap={20} color={resolved === 'dark' ? '#222a39' : '#dfe3ea'} />
          <Controls showInteractive={false} position="top-right" />
          {wide ? <MiniMap pannable zoomable ariaLabel="Overview of the automation" nodeColor={c.map} maskColor={c.mask} position="bottom-left" style={{ width: 140, height: 96 }} /> : null}
        </ReactFlow>
      </div>
      <ConfirmDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }} danger confirmLabel="Delete" title={pending && pending.nodes.length > 1 ? `Delete ${pending.nodes.length} steps?` : 'Delete this step?'}
        description="Steps that only it led to are removed as well. You can undo this with Ctrl/Cmd+Z." onConfirm={async () => { for (const id of pending?.nodes ?? []) p.onRemove(id); setPending(null); }} />
    </section>
  );
}

export function Canvas(p: CanvasProps) { return <ReactFlowProvider><CanvasInner {...p} /></ReactFlowProvider>; }
