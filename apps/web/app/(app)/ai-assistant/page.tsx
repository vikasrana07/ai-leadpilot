'use client';

import { AI_LANGUAGES, AI_TONES } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Gauge, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { TOOL_INFO, type AiRun, type AiUsage, type Assistant, type ScoringRules } from '@/lib/ai';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useTerms } from '@/lib/pack';
import { applyTerms } from '@/lib/terms-text';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']] as const;
const LANG_LABEL: Record<string, string> = { en: 'English', hi: 'Hindi', hinglish: 'Hinglish' };
const TABS = [['assistant', 'Assistant'], ['scoring', 'Lead scoring'], ['activity', 'Activity & usage']] as const;

function UsageMeter({ u }: { u: AiUsage }) {
  return (
    <Card className="mb-4">
      <CardBody className="space-y-2">
        <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-1.5 font-medium"><Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />AI usage this month</span><span className="num text-muted-foreground">{u.used.toLocaleString('en-IN')} of {u.cap.toLocaleString('en-IN')} tokens · {u.runs} replies</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Monthly AI token usage" aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100}><div className={cn('h-full rounded-full transition-[width] duration-500', u.exceeded ? 'bg-danger' : u.warning ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(2, u.pct)}%` }} /></div>
        {u.exceeded ? <p className="text-[12px] text-danger">The monthly limit is reached. New chats are handed to your team until {new Date(u.resetsAt).toLocaleDateString()}.</p> : u.warning ? <p className="text-[12px] text-warning">You have used over 80% of this month&apos;s limit.</p> : null}
        {u.killSwitch ? <p className="text-[12px] text-danger">The AI is switched off platform-wide right now.</p> : null}
      </CardBody>
    </Card>
  );
}

function AssistantForm({ data }: { data: Assistant }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Assistant>(data);
  const [keywords, setKeywords] = useState(data.handoverRules.keywords.join(', '));
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Assistant>(k: K, v: Assistant[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: () => { const { provider: _p, killSwitch: _k, ...body } = f; void _p; void _k; return api<Assistant>('/ai/assistant', { method: 'PUT', body: { ...body, handoverRules: { ...f.handoverRules, keywords: keywords.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) } } }); },
    onSuccess: async () => { setErr(null); toast.success('Assistant saved'); await qc.invalidateQueries({ queryKey: ['ai'] }); },
    onError: (e) => setErr(e instanceof ApiError ? (e.details?.map((d) => `${d.path}: ${d.message}`).join(' · ') ?? e.message) : 'Could not save'),
  });
  const toggleTool = (name: string) => set('allowedTools', f.allowedTools.includes(name) ? f.allowedTools.filter((t) => t !== name) : [...f.allowedTools, name]);

  return (
    <div className="space-y-4">
      {data.provider === 'mock' ? (
        <div role="note" className="flex gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13px] text-warning"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p><strong>Demo mode.</strong> Replies come from a simple offline stand-in, not a real language model, so they are basic. Everything else (knowledge, tools, scoring, handover, limits) is real. Connect an OpenAI key (<code>AI_PROVIDER=openai</code>) for natural conversations.</p></div>
      ) : null}

      <Card>
        <CardHeader><div><CardTitle>Status</CardTitle><p className="text-helper mt-0.5">When on, the assistant starts every new conversation and hands over to your team when needed.</p></div>
          <label className="flex items-center gap-2 text-[13px] font-medium"><input type="checkbox" role="switch" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />{f.enabled ? 'On' : 'Off'}</label></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Assistant name" htmlFor="a-name"><Input id="a-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Business name customers see" htmlFor="a-ident"><Input id="a-ident" value={f.businessIdentity} onChange={(e) => set('businessIdentity', e.target.value)} /></Field>
          <Field label="About the business" htmlFor="a-desc" className="sm:col-span-2" hint="A few sentences the assistant can rely on: what you sell, where, what makes you different."><Textarea id="a-desc" value={f.businessDescription} onChange={(e) => set('businessDescription', e.target.value)} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Voice</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Languages" htmlFor="a-langs" hint="It replies in the customer's language.">
            <div id="a-langs" className="flex flex-wrap gap-3 pt-1">{AI_LANGUAGES.map((l) => <label key={l} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={f.languages.includes(l)} onChange={(e) => set('languages', e.target.checked ? [...f.languages, l] : f.languages.filter((x) => x !== l))} />{LANG_LABEL[l]}</label>)}</div>
          </Field>
          <Field label="Tone" htmlFor="a-tone"><Select id="a-tone" value={f.tone} onChange={(e) => set('tone', e.target.value)}>{AI_TONES.map((t) => <option key={t} value={t}>{t[0]?.toUpperCase()}{t.slice(1)}</option>)}</Select></Field>
          <Field label="Welcome message" htmlFor="a-welcome" className="sm:col-span-2" hint="Used to open the first reply in a new conversation."><Input id="a-welcome" value={f.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} /></Field>
          <Field label="Extra instructions" htmlFor="a-instr" className="sm:col-span-2" hint="Your own guidance, for example “mention the clubhouse”. The built-in safety rules always take priority."><Textarea id="a-instr" value={f.systemInstructions} onChange={(e) => set('systemInstructions', e.target.value)} /></Field>
          <Field label="AI disclosure" htmlFor="a-disc" className="sm:col-span-2" hint="Added to the first reply so customers know they are talking to an automated assistant. Recommended."><Input id="a-disc" placeholder="I'm an automated assistant. A team member can join any time." value={f.disclosureText} onChange={(e) => set('disclosureText', e.target.value)} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>What it can do</CardTitle><p className="text-helper">Every action runs through your normal rules and is logged.</p></CardHeader>
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {TOOL_INFO.map((t) => (
              <li key={t.name}><label className={cn('flex items-start gap-3 rounded-lg border border-border p-3', t.soon && 'opacity-60')}>
                <input type="checkbox" className="mt-0.5" disabled={t.soon} checked={f.allowedTools.includes(t.name)} onChange={() => toggleTool(t.name)} />
                <span className="text-[13px]"><span className="font-medium">{t.label}</span>{t.soon ? <Badge className="ml-2">Soon</Badge> : null}{t.sensitive ? <Badge tone="warning" className="ml-2">Use with care</Badge> : null}<span className="text-helper block">{t.help}</span></span>
              </label></li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Handing over to your team</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <Field label="Words that always hand over" htmlFor="a-kw" hint="Separated by commas. If a customer writes any of these, a person takes over right away, without waiting for the AI."><Input id="a-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-5 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.handoverRules.onNegotiation} onChange={(e) => set('handoverRules', { ...f.handoverRules, onNegotiation: e.target.checked })} />Price negotiation and discounts</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.handoverRules.onComplaint} onChange={(e) => set('handoverRules', { ...f.handoverRules, onComplaint: e.target.checked })} />Complaints and legal questions</label>
          </div>
          <Field label="Message when it cannot help" htmlFor="a-fb"><Input id="a-fb" value={f.fallbackMessage} onChange={(e) => set('fallbackMessage', e.target.value)} /></Field>
          <div>
            <label className="mb-2 flex items-center gap-2 text-[13px] font-medium"><input type="checkbox" checked={f.workingHours.enabled} onChange={(e) => set('workingHours', { ...f.workingHours, enabled: e.target.checked })} />Team working hours</label>
            <p className="text-helper mb-2">Used to tell customers when to expect a person. The assistant replies at any hour either way.</p>
            {f.workingHours.enabled ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {DAYS.map(([k, label]) => { const d = f.workingHours.days[k]; return (
                  <li key={k} className="flex items-center gap-2 text-[13px]">
                    <label className="flex w-28 items-center gap-2"><input type="checkbox" checked={d !== null} onChange={(e) => set('workingHours', { ...f.workingHours, days: { ...f.workingHours.days, [k]: e.target.checked ? { start: '10:00', end: '19:00' } : null } })} />{label}</label>
                    {d ? <div className="flex items-center gap-2"><Input aria-label={`${label} opens`} type="time" className="h-8 w-36 px-2.5" value={d.start} onChange={(e) => set('workingHours', { ...f.workingHours, days: { ...f.workingHours.days, [k]: { ...d, start: e.target.value } } })} /><span className="text-muted-foreground">to</span><Input aria-label={`${label} closes`} type="time" className="h-8 w-36 px-2.5" value={d.end} onChange={(e) => set('workingHours', { ...f.workingHours, days: { ...f.workingHours.days, [k]: { ...d, end: e.target.value } } })} /></div> : <span className="text-helper">Closed</span>}
                  </li>
                ); })}
              </ul>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Limits</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Longest reply (characters)" htmlFor="a-max"><Input id="a-max" type="number" min={100} max={1500} value={f.maxReplyChars} onChange={(e) => set('maxReplyChars', Number(e.target.value))} /></Field>
          <Field label="Creativity (0 to 1)" htmlFor="a-temp" hint="Lower is more predictable."><Input id="a-temp" type="number" step="0.1" min={0} max={1} value={f.temperature} onChange={(e) => set('temperature', Number(e.target.value))} /></Field>
          <Field label="Monthly token limit" htmlFor="a-cap" hint="Hard stop. Leave empty for the plan default."><Input id="a-cap" type="number" min={10000} placeholder="Plan default" value={f.monthlyTokenCap ?? ''} onChange={(e) => set('monthlyTokenCap', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          <Field label="Model override" htmlFor="a-model" className="sm:col-span-3" hint="Leave empty to use the platform default."><Input id="a-model" value={f.model ?? ''} onChange={(e) => set('model', e.target.value.trim() === '' ? null : e.target.value)} /></Field>
        </CardBody>
      </Card>

      {err ? <p role="alert" className="text-[13px] text-danger">{err}</p> : null}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save assistant</Button></div>
    </div>
  );
}

function ScoringTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'scoring'], queryFn: () => api<{ version: number; rules: ScoringRules; defaults: ScoringRules }>('/scoring/rules') });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (!q.data) return null;
  return <ScoringEditor key={q.data.version} data={q.data} onSaved={() => qc.invalidateQueries({ queryKey: ['ai'] })} />;
}

function ScoringEditor({ data, onSaved }: { data: { version: number; rules: ScoringRules; defaults: ScoringRules }; onSaved: () => Promise<void> }) {
  const terms = useTerms();
  const [r, setR] = useState<ScoringRules>(data.rules);
  const [err, setErr] = useState<string | null>(null);
  const total = r.criteria.filter((c) => c.enabled).reduce((s, c) => s + c.points, 0);
  const save = useMutation({ mutationFn: () => api('/scoring/rules', { method: 'PUT', body: r }), onSuccess: async () => { setErr(null); toast.success('Scoring rules saved. Existing leads are being re-scored.'); await onSaved(); }, onError: (e) => setErr(e instanceof ApiError ? (e.details?.map((d) => d.message).join(' · ') ?? e.message) : 'Could not save') });
  return (
    <Card>
      <CardHeader><div><CardTitle>{applyTerms('Lead scoring rules', terms)}</CardTitle><p className="text-helper mt-0.5">Points are added when the customer has shared something. Missing information is never held against {terms.aLead}. Version {data.version || 'default'}.</p></div></CardHeader>
      <CardBody className="space-y-4">
        <ul className="space-y-2">
          {r.criteria.map((c, i) => (
            <li key={c.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <input type="checkbox" aria-label={`Use ${c.label}`} checked={c.enabled} onChange={(e) => setR({ ...r, criteria: r.criteria.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
              <Input aria-label={`Label for ${c.key}`} className="h-8 min-w-48 flex-1" value={c.label} onChange={(e) => setR({ ...r, criteria: r.criteria.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input aria-label={`Points for ${c.label}`} type="number" min={0} max={100} className="h-8 w-20" value={c.points} onChange={(e) => setR({ ...r, criteria: r.criteria.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)) })} />
              <span className="text-helper">points</span>
            </li>
          ))}
        </ul>
        <p className="text-helper num">Maximum possible score: {Math.min(100, total)}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hot from" htmlFor="s-hot" hint="Score at or above this is Hot."><Input id="s-hot" type="number" min={1} max={100} value={r.hotMin} onChange={(e) => setR({ ...r, hotMin: Number(e.target.value) })} /></Field>
          <Field label="Warm from" htmlFor="s-warm" hint="Between this and Hot is Warm. Below is Cold."><Input id="s-warm" type="number" min={1} max={100} value={r.warmMin} onChange={(e) => setR({ ...r, warmMin: Number(e.target.value) })} /></Field>
        </div>
        {err ? <p role="alert" className="text-[13px] text-danger">{err}</p> : null}
        <div className="flex gap-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save rules</Button><Button onClick={() => setR(data.defaults)}>Reset to defaults</Button></div>
      </CardBody>
    </Card>
  );
}

const STATUS_TONE = { COMPLETED: 'success', FAILED: 'danger', SKIPPED: 'warning', RUNNING: 'primary' } as const;
const OUTCOME: Record<string, string> = { replied: 'Replied', keyword_handover: 'Handed over (keyword)', model_handover: 'Handed over', guard_blocked: 'Blocked by safety check, handed over', token_cap_exceeded: 'Stopped: usage limit', send_blocked: 'Reply blocked by WhatsApp rules', error: 'Error, handed over', iteration_limit: 'Too many steps, handed over' };

function ActivityTab() {
  const runs = useQuery({ queryKey: ['ai', 'runs'], queryFn: () => api<AiRun[]>('/ai/runs') });
  return (
    <Card className="overflow-hidden">
      <CardHeader><div><CardTitle>Recent assistant activity</CardTitle><p className="text-helper mt-0.5">One row per reply attempt. Customer messages are not copied here.</p></div></CardHeader>
      {runs.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : runs.data?.length === 0 ? <p className="text-helper p-6 text-center">No activity yet. Replies appear here once customers start chatting with the assistant.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-muted/50 text-label text-muted-foreground"><tr><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Result</th><th className="px-4 py-2 font-medium">Actions taken</th><th className="px-4 py-2 text-right font-medium">Tokens</th><th className="px-4 py-2 text-right font-medium">Time</th><th /></tr></thead>
          <tbody className="divide-y divide-border">{runs.data?.map((r) => (
            <tr key={r.id} className="align-top hover:bg-muted/40">
              <td className="num whitespace-nowrap px-4 py-2 text-muted-foreground">{timeAgo(r.createdAt)}</td>
              <td className="px-4 py-2"><Badge tone={STATUS_TONE[r.status]}>{OUTCOME[r.outcome ?? ''] ?? r.status.toLowerCase()}</Badge>{r.guardViolations.length ? <p className="text-helper mt-1 text-warning">Safety check: {r.guardViolations.join(', ')}</p> : null}{r.error ? <p className="text-helper mt-1 text-danger">{r.error}</p> : null}</td>
              <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{r.tools.length ? r.tools.map((t, i) => <Badge key={i} tone={t.ok ? 'neutral' : 'danger'} className="font-mono">{t.name}</Badge>) : <span className="text-muted-foreground">—</span>}</div></td>
              <td className="num px-4 py-2 text-right">{(r.inputTokens + r.outputTokens).toLocaleString('en-IN')}</td>
              <td className="num px-4 py-2 text-right text-muted-foreground">{r.latencyMs !== null ? `${(r.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
              <td className="px-4 py-2 text-right"><Link className="text-primary underline underline-offset-2 hover:no-underline" href={`/inbox?c=${r.conversationId}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

export default function AiAssistantPage() {
  const terms = useTerms();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('assistant');
  const assistant = useQuery({ queryKey: ['ai', 'assistant'], queryFn: () => api<Assistant>('/ai/assistant') });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api<AiUsage>('/ai/usage'), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="AI assistant" description="Greets new enquiries, asks the right questions, answers from your inventory and documents, and brings in your team when it should." actions={assistant.data ? <Badge tone={assistant.data.enabled ? 'success' : 'neutral'}><Bot className="h-3 w-3" aria-hidden />{assistant.data.enabled ? 'On' : 'Off'}</Badge> : undefined} />
      {usage.data ? <UsageMeter u={usage.data} /> : null}
      <div role="tablist" aria-label="Assistant sections" className="mb-4 flex gap-1 border-b border-border">
        {TABS.map(([k, rawLabel]) => { const label = applyTerms(rawLabel, terms); return <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('relative px-3 py-2.5 text-[13px] font-medium', tab === k ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}{tab === k ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}</button>; })}
      </div>
      {tab === 'assistant' ? (assistant.isPending ? <Skeleton className="h-96" /> : assistant.isError || !assistant.data ? <p className="flex items-center gap-2 text-[13px] text-danger"><Info className="h-4 w-4" aria-hidden />Could not load the assistant settings.</p> : <AssistantForm key={JSON.stringify(assistant.data).length} data={assistant.data} />) : tab === 'scoring' ? <ScoringTab /> : <ActivityTab />}
    </>
  );
}
