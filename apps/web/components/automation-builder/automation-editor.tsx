'use client';

import { graphErrors, summarizeGraph, validateGraph, type AutomationGraph, type GraphIssue } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, Info, ListTree, Network, Power, Redo2, Save, Undo2, Workflow, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { useMediaQuery } from '@/hooks/use-media-query';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/pack';
import { chooseView, useEditorView } from '@/lib/automation-view';
import { blankGraph, canonical, defaultNode, editorReducer, initialState, isDirty, nodeById, setNodeTerms, type Slot } from '@/lib/automation-graph-state';
import { handleApiError } from '@/lib/forms';
import type { AutomationItem, AutomationRun, DryRunPathItem, DryRunResult } from '@/lib/ops';
import { Canvas } from './canvas';
import { marksFromDryRun, marksFromRun, missingFromGraph, takenEdges } from './canvas-overlay';
import { DryRunDialog } from './dry-run-dialog';
import { Inspector } from './inspector';
import { Outline, type AddKind } from './outline';
import { Summary } from './summary';
import { UnsavedGuard } from './unsaved-guard';

interface Source { id?: string; name: string; description: string; cooldownMinutes: number; graph: AutomationGraph; version: number; enabled: boolean }
const newId = () => `s${Math.random().toString(36).slice(2, 8)}`;
const issueKey = (i: GraphIssue) => `${i.code}|${i.nodeId ?? ''}|${i.edgeId ?? ''}|${i.message}`;
/** Schema messages arrive as "nodes.3.data.title: Too small..."; show the part a person can act on. */
const friendly = (i: GraphIssue): GraphIssue => (i.code === 'schema' ? { ...i, message: i.message.replace(/^nodes\.\d+\.(data\.)?/, '').replace(/^graph: /, '') } : i);

interface DraftData { graph: AutomationGraph; name: string; description: string; cooldown: string }
/** A draft from earlier in this tab that differs from what was loaded; storage may be unavailable or hold junk, which just means no draft. */
function readDraft(key: string, initial: Source): DraftData | null {
  try {
    const raw = typeof window === 'undefined' ? null : window.sessionStorage.getItem(key); if (!raw) return null;
    const d = JSON.parse(raw) as DraftData;
    if (!d || !d.graph || !Array.isArray(d.graph.nodes) || typeof d.name !== 'string') return null;
    return canonical(d.graph) !== canonical(initial.graph) || d.name !== initial.name || d.description !== initial.description || d.cooldown !== String(initial.cooldownMinutes) ? d : null;
  } catch { return null; }
}

/** Loads the automation (or starts a blank one) and hands it to the editor. */
export function AutomationEditor({ id }: { id?: string }) {
  const { can } = useAuth();
  const allowed = can('automation:manage');
  const leadWord = useTerms().lead;
  const q = useQuery({ queryKey: ['automations', 'one', id], enabled: !!id && allowed, queryFn: () => api<AutomationItem>(`/automations/${id}`), gcTime: 0, refetchOnWindowFocus: false, retry: false });
  const blank = useMemo<Source>(() => ({ name: '', description: '', cooldownMinutes: 60, graph: blankGraph({ trigger: newId(), action: newId() }, leadWord), version: 1, enabled: false }), [leadWord]);
  if (!allowed) return <><PageHeader title="Automations" /><Card><EmptyState icon={Workflow} title="You do not have access" description="Ask a workspace owner or manager for the automations permission." /></Card></>;
  if (id && q.isPending) return <><PageHeader title="Edit automation" /><Skeleton className="h-96" /></>;
  if (id && (q.isError || !q.data)) return <><PageHeader title="Edit automation" /><Card><EmptyState icon={Workflow} title="Automation not found" description="It may have been deleted, or the link is wrong." action={<Button asChild variant="primary"><Link href="/automations">Back to automations</Link></Button>} /></Card></>;
  const d = q.data;
  const source: Source = d ? { id: d.id, name: d.name, description: d.description ?? '', cooldownMinutes: d.cooldownMinutes, graph: d.graph, version: d.version, enabled: d.enabled } : blank;
  return <EditorBody key={id ?? 'new'} initial={source} reload={id ? async () => (await q.refetch()).data ?? null : null} />;
}

function EditorBody({ initial, reload }: { initial: Source; reload: (() => Promise<AutomationItem | null>) | null }) {
  const router = useRouter(); const qc = useQueryClient();
  const terms = useTerms();
  setNodeTerms(terms.summary); // before anything renders a step title
  const [server, setServer] = useState<Source>(initial);
  const [state, dispatch] = useReducer(editorReducer, initial.graph, initialState);
  const [name, setName] = useState(initial.name); const [description, setDescription] = useState(initial.description); const [cooldown, setCooldown] = useState(String(initial.cooldownMinutes));
  const [attempted, setAttempted] = useState(false); const [saving, setSaving] = useState(false); const [conflict, setConflict] = useState(false);
  const [serverIssues, setServerIssues] = useState<GraphIssue[]>([]); const [refIssues, setRefIssues] = useState<GraphIssue[]>([]);
  const [testOpen, setTestOpen] = useState(false); const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [draft, setDraft] = useState<DraftData | null>(() => readDraft(`lp:automation-draft:${initial.id ?? 'new'}`, initial));
  const [dismissedSeq, setDismissedSeq] = useState(0);
  const inspectorRef = useRef<HTMLHeadingElement>(null); const problemsRef = useRef<HTMLHeadingElement>(null); const nameRef = useRef<HTMLInputElement>(null);
  const wantInspectorFocus = useRef(false);
  // ---- Canvas | Outline. Phones always start in the Outline and only get a read-only canvas; a desktop remembers the last choice.
  const desktop = useMediaQuery('(min-width: 768px)');
  const view = useEditorView(desktop);
  // ---- "View on canvas" from run history opens this page with ?run=<id>: the canvas then shows what that run did, read-only
  const pathname = usePathname();
  const urlRun = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get('run'), () => null);
  const [runDismissed, setRunDismissed] = useState(false);
  const runId = runDismissed ? null : urlRun;
  const runQ = useQuery({ queryKey: ['automations', 'run', runId], enabled: !!runId, queryFn: () => api<AutomationRun>(`/automations/runs/${runId}`), retry: false, refetchOnWindowFocus: false });
  const closeRun = () => { setRunDismissed(true); router.replace(pathname); };
  const draftKey = `lp:automation-draft:${initial.id ?? 'new'}`;

  const { graph } = state;
  const clientIssues = useMemo(() => validateGraph(graph).map(friendly), [graph]);
  const issues = useMemo(() => { const seen = new Set(clientIssues.map(issueKey)); const refs = graphErrors(clientIssues).length ? [] : refIssues; return [...clientIssues, ...[...refs, ...serverIssues].map(friendly).filter((i) => { const k = issueKey(i); if (seen.has(k)) return false; seen.add(k); return true; })]; }, [clientIssues, refIssues, serverIssues]);
  const errors = graphErrors(issues); const valid = errors.length === 0;
  const dirty = isDirty(state) || name !== server.name || description !== server.description || cooldown !== String(server.cooldownMinutes);
  const nameError = attempted && (name.trim().length < 2 || name.trim().length > 120) ? 'Give it a name of 2 to 120 characters.' : undefined;
  const cooldownN = Number(cooldown); const cooldownError = cooldown.trim() === '' || !Number.isInteger(cooldownN) || cooldownN < 0 || cooldownN > 43200 ? 'Enter whole minutes from 0 to 43,200 (30 days).' : undefined;
  const selectedNode = state.selected ? nodeById(graph, state.selected) : undefined;
  const overlay = useMemo(() => (dryRun ? new Map<string, DryRunPathItem>(dryRun.path.map((p) => [p.nodeId, p])) : null), [dryRun]);
  const run = runId ? runQ.data : undefined;
  const marks = useMemo(() => (run ? marksFromRun(graph, run.steps as never) : dryRun ? marksFromDryRun(graph, dryRun.path) : null), [graph, run, dryRun]);
  const taken = useMemo(() => (marks ? takenEdges(graph, marks) : null), [graph, marks]);
  const showCanvas = view === 'canvas' || !!runId;
  const canvasReadOnly = !desktop || !!runId;
  const summaryText = valid ? summarizeGraph(graph, terms.summary).map((l) => l.trim().replace(/^- /, '')).join('. ') : 'The automation has problems to fix.';

  // ---- announcements: structural changes are spoken once; refusals are also shown for a few seconds
  const visibleError = state.noticeIsError && state.noticeSeq !== dismissedSeq ? state.notice : '';
  useEffect(() => {
    if (!state.noticeIsError) return;
    const seq = state.noticeSeq; const t = window.setTimeout(() => setDismissedSeq(seq), 8000);
    return () => window.clearTimeout(t);
  }, [state.noticeSeq, state.noticeIsError]);

  // ---- focus the inspector after a step is opened with Enter/click
  useEffect(() => { if (wantInspectorFocus.current && state.selected) { wantInspectorFocus.current = false; requestAnimationFrame(() => inspectorRef.current?.focus()); } }, [state.selected]);

  // ---- reference checks the browser cannot do (a stage or person that no longer exists), a moment after the last edit
  const settled = useDebounce(graph, 900);
  useEffect(() => {
    if (graphErrors(validateGraph(settled)).length) return; // structural problems come first; reference checks need a well-formed graph
    let cancelled = false;
    api<{ issues: GraphIssue[] }>('/automations/validate', { method: 'POST', body: { graph: settled } })
      .then((r) => { if (!cancelled) setRefIssues(r.issues); }).catch(() => { if (!cancelled) setRefIssues([]); });
    return () => { cancelled = true; };
  }, [settled]);

  // ---- draft in this tab (offered for restore above), kept up to date while there are unsaved changes
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      try { if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ graph, name, description, cooldown, baseVersion: server.version, ts: Date.now() })); else sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
    }, 500);
    return () => { if (persistTimer.current) window.clearTimeout(persistTimer.current); };
  }, [dirty, graph, name, description, cooldown, server.version, draftKey]);

  // ---- save
  const flashProblems = () => { problemsRef.current?.scrollIntoView({ block: 'center' }); problemsRef.current?.focus(); };
  const save = useCallback(async () => {
    setAttempted(true);
    if (saving) return;
    const nm = name.trim();
    if (nm.length < 2 || nm.length > 120) { nameRef.current?.focus(); return; }
    if (cooldownError) { document.getElementById('ae-cooldown')?.focus(); return; }
    if (!valid) { toast.error(`Fix ${errors.length} problem${errors.length === 1 ? '' : 's'} before saving.`); flashProblems(); return; }
    setSaving(true);
    try {
      const body = { name: nm, description: description.trim() || null, graph, cooldownMinutes: cooldownN, ...(server.id ? { expectedVersion: server.version } : {}) };
      const res = server.id ? await api<AutomationItem>(`/automations/${server.id}`, { method: 'PUT', body }) : await api<AutomationItem>('/automations', { method: 'POST', body });
      dispatch({ type: 'markSaved' });
      setServer({ id: res.id, name: res.name, description: res.description ?? '', cooldownMinutes: res.cooldownMinutes, graph, version: res.version, enabled: res.enabled });
      setName(res.name); setDescription(res.description ?? ''); setCooldown(String(res.cooldownMinutes));
      setServerIssues([]); setConflict(false); setDraft(null);
      try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
      void qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success(server.id ? `Saved (version ${res.version})` : 'Saved. It is switched off until you turn it on.');
      if (!server.id) router.replace(`/automations/${res.id}/edit`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true);
      else if (e instanceof ApiError && e.code === 'invalid_graph') { setServerIssues(((e.details ?? []) as unknown as GraphIssue[]).filter((d) => d && typeof d.message === 'string')); toast.error(e.message); flashProblems(); }
      else handleApiError(e);
    } finally { setSaving(false); }
  }, [saving, name, cooldownError, valid, errors.length, description, graph, cooldownN, server.id, server.version, draftKey, qc, router]);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<AutomationItem>(`/automations/${server.id}/enable`, { method: 'POST', body: { enabled } }),
    onSuccess: (r) => { setServer((s) => ({ ...s, enabled: r.enabled })); toast.success(r.enabled ? 'Turned on. It reacts to new events from now.' : 'Turned off. Waiting runs were ended.'); void qc.invalidateQueries({ queryKey: ['automations'] }); },
    onError: (e) => handleApiError(e),
  });

  // ---- keyboard shortcuts: Ctrl/Cmd+S saves anywhere; undo/redo only outside text fields (inside them the browser's own undo applies)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase(); const t = e.target as HTMLElement | null;
      if (k === 's') { e.preventDefault(); void save(); return; }
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save]);

  const onEdit = (id: string) => { wantInspectorFocus.current = true; dispatch({ type: 'select', id }); if (state.selected === id) { wantInspectorFocus.current = false; requestAnimationFrame(() => inspectorRef.current?.focus()); } };
  const onInsert = (parentId: string, slot: Slot, kind: AddKind) => dispatch({ type: 'insert', parentId, slot, node: defaultNode(kind, newId()) });
  const onFocused = useCallback(() => dispatch({ type: 'clearFocus' }), []);
  const goToStep = (id: string) => document.querySelector<HTMLElement>(`[data-step="${CSS.escape(id)}"]`)?.focus();
  const global = issues.filter((i) => !i.nodeId);
  const announce = `${state.noticeSeq ? state.notice : ''}${state.noticeSeq % 2 ? '' : '​'}`;

  return (
    <>
      <PageHeader
        title={server.id ? (name.trim() || 'Edit automation') : 'New automation'}
        breadcrumbs={[{ label: 'Automations', href: '/automations' }, { label: server.id ? 'Edit' : 'New' }]}
        description="Build what happens, step by step. Each step runs in order; a condition splits the path into If and Otherwise; a wait pauses until later."
        actions={<>
          <Button type="button" size="icon" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}><Undo2 className="h-4 w-4" aria-hidden /></Button>
          <Button type="button" size="icon" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}><Redo2 className="h-4 w-4" aria-hidden /></Button>
          <Button type="button" onClick={() => setTestOpen(true)} disabled={!server.id || !valid} title={!server.id ? 'Save once to be able to test' : !valid ? 'Fix the problems first' : undefined}><FlaskConical className="h-4 w-4" aria-hidden />Test</Button>
          {server.id ? <Button type="button" variant={server.enabled ? 'secondary' : 'primary'} loading={toggle.isPending} disabled={dirty || toggle.isPending} title={dirty ? 'Save your changes first' : undefined} onClick={() => toggle.mutate(!server.enabled)}><Power className="h-4 w-4" aria-hidden />{server.enabled ? 'Turn off' : 'Turn on'}</Button> : null}
          <Button type="button" variant="primary" loading={saving} disabled={!dirty && !!server.id} onClick={() => void save()}><Save className="h-4 w-4" aria-hidden />Save</Button>
        </>}
      />

      <div className="sr-only" role="status" aria-live="polite" data-testid="announcer">{announce}</div>
      {visibleError ? <p role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{visibleError}</p> : null}

      {conflict ? (
        <div role="alert" className="mb-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-[13px]" data-testid="conflict">
          <p className="font-medium text-warning">Someone else saved a newer version.</p>
          <p className="mt-1">Reload to see it before saving again. Reloading replaces what is on this screen with the saved version.</p>
          <div className="mt-2 flex gap-2">
            {reload ? <Button size="sm" variant="primary" onClick={async () => { const fresh = await reload(); if (!fresh) return; dispatch({ type: 'load', graph: fresh.graph }); setServer({ id: fresh.id, name: fresh.name, description: fresh.description ?? '', cooldownMinutes: fresh.cooldownMinutes, graph: fresh.graph, version: fresh.version, enabled: fresh.enabled }); setName(fresh.name); setDescription(fresh.description ?? ''); setCooldown(String(fresh.cooldownMinutes)); setConflict(false); toast.success('Loaded the latest version'); }}>Reload the latest version</Button> : null}
            <Button size="sm" onClick={() => setConflict(false)}>Keep editing</Button>
          </div>
        </div>
      ) : null}

      {draft ? (
        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-[13px]" data-testid="draft-banner">
          <Info className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1">You have unsaved changes from earlier in this tab.</span>
          <Button size="sm" variant="primary" onClick={() => { dispatch({ type: 'replace', graph: draft.graph }); setName(draft.name); setDescription(draft.description); setCooldown(draft.cooldown); setDraft(null); }}>Restore them</Button>
          <Button size="sm" onClick={() => { setDraft(null); try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ } }}>Discard</Button>
        </div>
      ) : null}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Name" htmlFor="ae-name" error={nameError}><Input id="ae-name" ref={nameRef} value={name} maxLength={120} placeholder={`e.g. Follow up on new ${terms.leads}`} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={`Do not repeat for the same ${terms.lead} within (minutes)`} htmlFor="ae-cooldown" error={attempted || cooldown !== String(server.cooldownMinutes) ? cooldownError : undefined} hint="0 means no limit. 1,440 = one day."><Input id="ae-cooldown" type="number" inputMode="numeric" min={0} max={43200} value={cooldown} onChange={(e) => setCooldown(e.target.value)} /></Field>
        </div>
        <Field label="Description (optional)" htmlFor="ae-desc" className="mt-3"><Textarea id="ae-desc" rows={2} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-0" /></Field>
        {server.id ? <p className="text-helper mt-3 flex flex-wrap items-center gap-2"><Badge tone={server.enabled ? 'success' : 'neutral'}>{server.enabled ? 'On' : 'Off'}</Badge><span>Version {server.version}. Changes apply to new events as soon as you save; runs already in progress finish with the version they started with.</span></p> : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className={selectedNode ? 'min-w-0 max-lg:pb-[66dvh]' : 'min-w-0'}>
          {errors.length || global.length ? (
            <section aria-labelledby="problems-h" className="mb-4 rounded-lg border border-danger/40 bg-danger-soft/40 p-3" data-testid="problems">
              <h2 id="problems-h" ref={problemsRef} tabIndex={-1} className="text-label mb-1 text-danger outline-none">{errors.length ? `Problems to fix (${errors.length})` : 'Notes'}</h2>
              <ul className="space-y-1 text-[13px]">{issues.filter((i) => i.severity === 'error' || !i.nodeId).map((i, ix) => (
                <li key={ix} className="flex flex-wrap items-start gap-x-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden /><span>{i.message}</span>
                  {i.nodeId && nodeById(graph, i.nodeId) ? <button type="button" className="min-h-8 font-medium text-primary underline underline-offset-2 hover:no-underline max-lg:min-h-11" onClick={() => goToStep(i.nodeId as string)}>Go to step</button> : null}</li>))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="steps-h">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h2 id="steps-h" className="text-heading">Steps</h2>
              {dryRun ? <Button size="sm" onClick={() => setDryRun(null)}>Clear test result</Button> : null}
            </div>
            <div role="tablist" aria-label="How to view the steps" className="mb-3 inline-flex rounded-md border border-border-strong p-0.5">
              {([['outline', 'Outline', ListTree], ['canvas', desktop ? 'Canvas' : 'Canvas (view only)', Network]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" role="tab" id={`view-tab-${v}`} aria-selected={showCanvas ? v === 'canvas' : v === 'outline'} aria-controls="view-panel" tabIndex={(showCanvas ? v === 'canvas' : v === 'outline') ? 0 : -1} data-testid={`view-${v}`}
                  onClick={() => { if (runId && v === 'outline') closeRun(); chooseView(v); }}
                  onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const to = v === 'outline' ? 'canvas' : 'outline'; if (runId && to === 'outline') closeRun(); chooseView(to); requestAnimationFrame(() => document.getElementById(`view-tab-${to}`)?.focus()); } }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11 ${(showCanvas ? v === 'canvas' : v === 'outline') ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />{label}</button>))}
            </div>
            <div id="view-panel" role="tabpanel" aria-labelledby={`view-tab-${showCanvas ? 'canvas' : 'outline'}`}>
            {showCanvas ? (
              <Canvas graph={graph} selected={state.selected} issues={issues} marks={marks} taken={taken} readOnly={canvasReadOnly} summaryText={summaryText} focus={state.focus} onFocused={onFocused}
                onSelect={(id) => dispatch({ type: 'select', id })} onEdit={onEdit} onInsert={onInsert} onRemove={(id) => dispatch({ type: 'remove', id })}
                onConnect={(from, slot, to) => dispatch({ type: 'connect', from, slot, to })} onPositions={(positions) => dispatch({ type: 'position', positions })} onTidy={() => dispatch({ type: 'tidy' })}>
                {runId ? (
                  <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]" data-testid="run-banner">
                    {runQ.isPending ? <span>Loading the run…</span> : runQ.isError || !run ? <span>That run could not be found.</span> : <>
                      <span className="min-w-0 flex-1">Showing a past run{run.leadName ? ` for ${run.leadName}` : ''}: <strong>{run.status.toLowerCase().replace('_', ' ')}</strong>, {new Date(run.createdAt).toLocaleString()}.
                        {missingFromGraph(graph, run.steps as never) ? ` ${missingFromGraph(graph, run.steps as never)} of its steps no longer exist because the automation was edited since.` : ''}</span></>}
                    <Button size="sm" onClick={closeRun}><X className="h-3.5 w-3.5" aria-hidden />Close</Button>
                  </div>
                ) : marks ? <p role="status" className="mb-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]" data-testid="test-legend"><strong>Test result.</strong> A ✓ marks the path that would be taken; steps with a dashed border and &quot;Not reached&quot; would not run.</p> : null}
              </Canvas>
            ) : (<>
            <details className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
              <summary className="cursor-pointer font-medium">How this editor works</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Open a step to change its settings; changes apply as soon as they are valid.</li>
                <li>Use the <strong>⋯</strong> menu on a step to add a step after it, move it, or delete it. Use <strong>Add action / condition / wait</strong> to extend a path.</li>
                <li>A <strong>condition</strong> splits into <em>If</em> and <em>Otherwise</em>. A <strong>wait</strong> pauses the automation; it can also have an <em>if they reply</em> path.</li>
                <li>&quot;What happens next&quot; in the step settings joins paths together. Steps can never loop back.</li>
                <li>Shortcuts: Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes (outside text fields).</li>
              </ul>
            </details>
            <Outline graph={graph} selected={state.selected} issues={issues} overlay={overlay} focus={state.focus} onFocused={onFocused} onEdit={onEdit} onInsert={onInsert}
              onRemove={(id) => dispatch({ type: 'remove', id })} onMove={(id, dir) => dispatch({ type: 'move', id, dir })} onConnect={(from, slot, to) => dispatch({ type: 'connect', from, slot, to })} />
            </>)}
            </div>
          </section>

          <div className="mt-4"><Summary graph={graph} valid={valid} /></div>
        </div>

        <aside aria-label="Step settings" data-testid="inspector-panel"
          className={selectedNode
            ? 'rounded-lg border border-border bg-card p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[62dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-lg lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto'
            : 'rounded-lg border border-dashed border-border p-4 max-lg:hidden lg:sticky lg:top-4 lg:self-start'}>
          {selectedNode ? (
            <Inspector ref={inspectorRef} graph={graph} node={selectedNode} issues={issues.filter((i) => i.nodeId === selectedNode.id)}
              onApply={(id, data) => dispatch({ type: 'update', id, data })} onConnect={(from, slot, to) => dispatch({ type: 'connect', from, slot, to })}
              onAddReply={(id) => dispatch({ type: 'insert', parentId: id, slot: 'replied', node: defaultNode('action', newId()) })}
              onRemove={(id) => dispatch({ type: 'remove', id })} onClose={(id) => { dispatch({ type: 'select', id: null }); dispatch({ type: 'focusStep', id }); }} />
          ) : (
            <div><h2 className="text-heading">Step settings</h2><p className="text-helper mt-1">Open a step to change it. Settings, and where each path goes next, appear here.</p></div>
          )}
        </aside>
      </div>

      {testOpen && server.id ? <DryRunDialog automationId={server.id} name={name} graph={graph} onClose={() => setTestOpen(false)} onResult={setDryRun} /> : null}
      <UnsavedGuard dirty={dirty} />
    </>
  );
}
