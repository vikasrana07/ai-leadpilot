'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, CircleAlert, FileText, Loader2, RefreshCw, Search, Trash2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, apiUpload } from '@/lib/api';
import type { KnowledgeDoc, KnowledgeHit } from '@/lib/ai';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

const ACCEPT = '.pdf,.docx,.txt,.md,.csv';
const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function StatusBadge({ d }: { d: KnowledgeDoc }) {
  if (d.status === 'READY') return <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden />Ready</Badge>;
  if (d.status === 'FAILED') return <Badge tone="danger"><CircleAlert className="h-3 w-3" aria-hidden />Failed</Badge>;
  return <Badge tone="primary"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{d.status === 'PENDING' ? 'Queued' : 'Processing'}</Badge>;
}

export default function KnowledgePage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [del, setDel] = useState<KnowledgeDoc | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [hits, setHits] = useState<KnowledgeHit[] | null>(null); const [searching, setSearching] = useState(false);

  // Poll while anything is still being processed.
  const docs = useQuery({ queryKey: ['knowledge', 'docs'], queryFn: () => api<KnowledgeDoc[]>('/knowledge/documents'), refetchInterval: (query) => (query.state.data?.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING') ? 1500 : false) });
  const preview = useQuery({ queryKey: ['knowledge', 'doc', view], enabled: !!view, queryFn: () => api<KnowledgeDoc & { preview: string[] }>(`/knowledge/documents/${view}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge'] });

  async function upload(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try { const fd = new FormData(); fd.append('file', f); await apiUpload('/knowledge/documents', fd); toast.success(`${f.name} uploaded. Processing…`); }
      catch (e) { toast.error(e instanceof ApiError ? `${f.name}: ${e.message}` : `Could not upload ${f.name}`); }
    }
    setUploading(null); if (input.current) input.current.value = ''; await refresh();
  }
  const reprocess = useMutation({ mutationFn: (id: string) => api(`/knowledge/documents/${id}/reprocess`, { method: 'POST' }), onSuccess: refresh, onError: (e) => handleApiError(e) });

  async function search() {
    if (q.trim().length < 2) return;
    setSearching(true);
    try { setHits(await api<KnowledgeHit[]>('/knowledge/search', { method: 'POST', body: { q, limit: 5 } })); } catch (e) { handleApiError(e); } finally { setSearching(false); }
  }

  return (
    <>
      <PageHeader title="Knowledge base" description="Documents your assistant answers from: brochures, FAQs, policies and price lists." />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
        className={cn('mb-6 flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors', drag ? 'border-primary bg-primary-soft/50' : 'border-border-strong bg-surface')}
      >
        <input ref={input} id="kb-file" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => e.target.files && void upload(e.target.files)} />
        <UploadCloud className="h-7 w-7 text-muted-foreground" aria-hidden />
        <p className="text-[13px] font-medium">{uploading ? `Uploading ${uploading}…` : 'Drag files here, or'}</p>
        <Button asChild variant="secondary" size="sm"><label htmlFor="kb-file" className="cursor-pointer">Choose files</label></Button>
        <p className="text-helper">PDF, DOCX, TXT or CSV, up to 10 MB each. Every file is scanned for viruses before it is stored.</p>
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHeader><CardTitle>Documents {docs.data ? <span className="num ml-1 font-normal text-muted-foreground">{docs.data.length}</span> : null}</CardTitle></CardHeader>
        {docs.isPending ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : docs.isError ? <EmptyState icon={BookOpen} title="Could not load documents" description="Please try again." action={<Button onClick={() => void docs.refetch()}>Retry</Button>} /> : docs.data.length === 0 ? (
          <EmptyState icon={BookOpen} title="No documents yet" description="Upload your brochures and FAQs so the assistant can answer from them instead of guessing." />
        ) : (
          <ul className="divide-y divide-border">
            {docs.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <button className="truncate text-[13px] font-medium hover:text-primary" onClick={() => setView(d.id)}>{d.title}</button>
                  <p className="text-helper num">{d.filename} · {kb(d.sizeBytes)} · {d.chunkCount ? `${d.chunkCount} passages · ` : ''}{timeAgo(d.createdAt)}</p>
                  {d.error ? <p className={cn('text-[12px]', d.status === 'FAILED' ? 'text-danger' : 'text-warning')}>{d.error}</p> : null}
                </div>
                <StatusBadge d={d} />
                <Button variant="ghost" size="icon" aria-label={`Reprocess ${d.title}`} onClick={() => reprocess.mutate(d.id)} disabled={d.status === 'PROCESSING'}><RefreshCw className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${d.title}`} onClick={() => setDel(d)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader><div><CardTitle>Test what the assistant can find</CardTitle><p className="text-helper mt-0.5">Ask a question the way a customer would and see which passages come back.</p></div></CardHeader>
        <CardBody className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /><Input aria-label="Search the knowledge base" className="pl-8" placeholder="e.g. What documents do I need for a home loan?" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Button type="submit" loading={searching} disabled={q.trim().length < 2}>Search</Button>
          </form>
          {hits ? (hits.length === 0 ? <p className="text-helper">Nothing relevant found. The assistant would tell the customer a team member will confirm.</p> : <ul className="space-y-2">{hits.map((h) => <li key={h.chunkId} className="rounded-lg border border-border p-3"><p className="text-label flex items-center justify-between"><span>{h.title}</span><span className="num text-muted-foreground">match {Math.round(h.score * 100)}%</span></p><p className="mt-1 text-[13px] text-muted-foreground">{h.content.slice(0, 300)}{h.content.length > 300 ? '…' : ''}</p></li>)}</ul>) : null}
        </CardBody>
      </Card>

      <ConfirmDialog open={del !== null} onOpenChange={(o) => { if (!o) setDel(null); }} danger title={`Delete ${del?.title ?? 'document'}?`} description="The file is removed and the assistant will stop using it straight away." confirmLabel="Delete" onConfirm={async () => { if (!del) return; try { await api(`/knowledge/documents/${del.id}`, { method: 'DELETE' }); toast.success('Document deleted'); await refresh(); } catch (e) { handleApiError(e); throw e; } }} />
      <Dialog open={view !== null} onOpenChange={(o) => { if (!o) setView(null); }}>
        <DialogContent title={preview.data?.title ?? 'Document'} description="The first passages the assistant can use." className="max-w-xl">
          {preview.isPending ? <Skeleton className="h-32" /> : <div className="space-y-3">{preview.data?.preview.length ? preview.data.preview.map((p, i) => <p key={i} className="rounded-md bg-muted p-3 text-[13px]">{p}</p>) : <p className="text-helper">No passages yet.</p>}</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
