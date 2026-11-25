'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, Loader2, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api, API_URL, ApiError } from '@/lib/api';

interface Report { dryRun: boolean; totalRows: number; valid: number; invalid: { row: number; errors: string[] }[]; duplicates?: { row: number; reason: string }[]; unknownColumns?: string[]; created: number; skipped?: number; jobId?: string }
interface QueuedResponse { jobId: string; status: 'QUEUED'; totalRows: number; message: string }
interface ImportJobStatus { jobId: string; status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'; totalRows: number; valid: number; created: number; skipped: number; invalid: { row: number; errors: string[] }[]; errorCsv?: string; error?: string }

function isQueued(res: Report | QueuedResponse): res is QueuedResponse {
  return 'jobId' in res && 'status' in res && res.status === 'QUEUED';
}

/** Two-step CSV import shared by leads and properties: validate (dry run) first, then confirm. */
export function ImportDialog({ open, onOpenChange, endpoint, title, hint, invalidate }: { open: boolean; onOpenChange: (o: boolean) => void; endpoint: string; title: string; hint: string; invalidate: string[][] }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [jobState, setJobState] = useState<ImportJobStatus | null>(null);
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setCsv(null); setFileName(''); setReport(null); setJobState(null); setCompletedJobId(null); if (input.current) input.current.value = ''; };

  async function pollJob(jobId: string): Promise<ImportJobStatus> {
    for (;;) {
      const status = await api<ImportJobStatus>(`/leads/import-jobs/${jobId}`);
      setJobState(status);
      if (status.status === 'COMPLETED') return status;
      if (status.status === 'FAILED') throw new Error(status.error || 'Background import failed');
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  async function downloadErrors(jobId: string) {
    try {
      const res = await fetch(`${API_URL}/leads/import-jobs/${jobId}/errors`, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not download error report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-errors-${jobId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download error CSV');
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 4_500_000) { toast.error('That file is too large (limit about 4 MB)'); return; }
    const text = await file.text();
    setCsv(text); setFileName(file.name); setBusy(true); setJobState(null); setCompletedJobId(null);
    try {
      const res = await api<Report | QueuedResponse>(endpoint, { method: 'POST', body: { csv: text, dryRun: true } });
      if (isQueued(res)) {
        setJobState({ jobId: res.jobId, status: 'QUEUED', totalRows: res.totalRows, valid: 0, created: 0, skipped: 0, invalid: [] });
        const done = await pollJob(res.jobId);
        setReport({ dryRun: true, totalRows: done.totalRows, valid: done.valid, invalid: done.invalid, created: done.created, skipped: done.skipped, jobId: done.jobId });
        setJobState(null);
      } else {
        setReport(res);
      }
    }
    catch (e) { setReport(null); setJobState(null); toast.error(e instanceof ApiError ? e.message : 'Could not read that file'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await api<Report | QueuedResponse>(endpoint, { method: 'POST', body: { csv, dryRun: false, duplicateStrategy: 'skip' } });
      if (isQueued(res)) {
        setJobState({ jobId: res.jobId, status: 'QUEUED', totalRows: res.totalRows, valid: 0, created: 0, skipped: 0, invalid: [] });
        const done = await pollJob(res.jobId);
        await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
        toast.success(`Imported ${done.created} ${done.created === 1 ? 'row' : 'rows'}`);
        if (done.invalid.length > 0) {
          setCompletedJobId(done.jobId);
          setReport({ dryRun: false, totalRows: done.totalRows, valid: done.valid, invalid: done.invalid, created: done.created, skipped: done.skipped, jobId: done.jobId });
          setJobState(null);
          return;
        }
        reset(); onOpenChange(false);
      } else {
        toast.success(`Imported ${res.created} ${res.created === 1 ? 'row' : 'rows'}`);
        await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
        reset(); onOpenChange(false);
      }
    } catch (e) { toast.error(e instanceof ApiError || e instanceof Error ? e.message : 'Import failed'); } finally { setBusy(false); }
  }

  const importable = report ? report.valid - (report.skipped ?? 0) : 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent title={title} description={hint} className="max-w-lg">
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="csv-file" onChange={(e) => void pick(e.target.files?.[0])} />
        <label htmlFor="csv-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong p-6 text-center hover:bg-muted/50">
          <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="text-[13px] font-medium">{fileName || 'Choose a CSV file'}</span>
          <span className="text-helper">We check every row before anything is saved.</span>
        </label>
        {jobState ? (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 text-[13px]" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            <div className="flex-1">
              <p className="font-medium">{jobState.status === 'QUEUED' ? 'Queued for background processing…' : 'Processing CSV batches…'}</p>
              <p className="text-helper num">{jobState.valid + jobState.invalid.length} of {jobState.totalRows} rows checked</p>
            </div>
          </div>
        ) : null}
        {report && !jobState ? (
          <div className="mt-4 space-y-3 text-[13px]" aria-live="polite">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              <span>
                {completedJobId ? (
                  <>Imported <strong className="num">{report.created}</strong> of <span className="num">{report.totalRows}</span> rows</>
                ) : (
                  <><strong className="num">{importable}</strong> of <span className="num">{report.totalRows}</span> rows will be imported</>
                )}
              </span>
            </p>
            {report.duplicates?.length ? <p className="text-muted-foreground"><span className="num">{report.duplicates.length}</span> look like duplicates and will be skipped.</p> : null}
            {report.unknownColumns?.length ? <p className="text-muted-foreground">Ignored columns: {report.unknownColumns.join(', ')}</p> : null}
            {report.invalid.length ? (
              <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-medium text-warning"><TriangleAlert className="h-4 w-4" aria-hidden /><span className="num">{report.invalid.length}</span> rows have problems{completedJobId ? ' and were skipped' : ' and will be skipped'}</p>
                  {report.jobId ? (
                    <Button size="sm" variant="ghost" onClick={() => void downloadErrors(report.jobId!)}>
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Download error CSV
                    </Button>
                  ) : null}
                </div>
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[12px]">{report.invalid.slice(0, 30).map((r) => <li key={r.row}><span className="num font-medium">Row {r.row}:</span> {r.errors.join('; ')}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{completedJobId ? 'Done' : 'Cancel'}</Button>
          {!completedJobId ? (
            <Button variant="primary" disabled={!report || importable === 0 || !!jobState} loading={busy} onClick={() => void confirm()}>Import {importable > 0 ? importable : ''}</Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
