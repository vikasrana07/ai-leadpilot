'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';

interface Report { dryRun: boolean; totalRows: number; valid: number; invalid: { row: number; errors: string[] }[]; duplicates?: { row: number; reason: string }[]; unknownColumns?: string[]; created: number; skipped?: number }

/** Two-step CSV import shared by leads and properties: validate (dry run) first, then confirm. */
export function ImportDialog({ open, onOpenChange, endpoint, title, hint, invalidate }: { open: boolean; onOpenChange: (o: boolean) => void; endpoint: string; title: string; hint: string; invalidate: string[][] }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setCsv(null); setFileName(''); setReport(null); if (input.current) input.current.value = ''; };

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 4_500_000) { toast.error('That file is too large (limit about 4 MB)'); return; }
    const text = await file.text();
    setCsv(text); setFileName(file.name); setBusy(true);
    try { setReport(await api<Report>(endpoint, { method: 'POST', body: { csv: text, dryRun: true } })); }
    catch (e) { setReport(null); toast.error(e instanceof ApiError ? e.message : 'Could not read that file'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await api<Report>(endpoint, { method: 'POST', body: { csv, dryRun: false, duplicateStrategy: 'skip' } });
      toast.success(`Imported ${r.created} ${r.created === 1 ? 'row' : 'rows'}`);
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      reset(); onOpenChange(false);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Import failed'); } finally { setBusy(false); }
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
        {report ? (
          <div className="mt-4 space-y-3 text-[13px]" aria-live="polite">
            <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /><span><strong className="num">{importable}</strong> of <span className="num">{report.totalRows}</span> rows will be imported</span></p>
            {report.duplicates?.length ? <p className="text-muted-foreground"><span className="num">{report.duplicates.length}</span> look like duplicates and will be skipped.</p> : null}
            {report.unknownColumns?.length ? <p className="text-muted-foreground">Ignored columns: {report.unknownColumns.join(', ')}</p> : null}
            {report.invalid.length ? (
              <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
                <p className="flex items-center gap-1.5 font-medium text-warning"><TriangleAlert className="h-4 w-4" aria-hidden /><span className="num">{report.invalid.length}</span> rows have problems and will be skipped</p>
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[12px]">{report.invalid.slice(0, 30).map((r) => <li key={r.row}><span className="num font-medium">Row {r.row}:</span> {r.errors.join('; ')}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!report || importable === 0} loading={busy} onClick={() => void confirm()}>Import {importable > 0 ? importable : ''}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
