'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api, API_URL, ApiError, apiUpload } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

export interface LeadAttachmentItem {
  id: string;
  leadId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

const formatBytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

export function LeadAttachmentsCard({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [delTarget, setDelTarget] = useState<LeadAttachmentItem | null>(null);

  const attachments = useQuery({
    queryKey: ['leads', leadId, 'attachments'],
    queryFn: () => api<LeadAttachmentItem[]>(`/leads/${leadId}/attachments`),
  });

  const remove = useMutation({
    mutationFn: (attId: string) => api(`/leads/${leadId}/attachments/${attId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Attachment deleted');
      setDelTarget(null);
      await qc.invalidateQueries({ queryKey: ['leads', leadId] });
    },
    onError: (e) => handleApiError(e),
  });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        await apiUpload(`/leads/${leadId}/attachments`, fd);
        toast.success(`Attached ${file.name}`);
      }
      await qc.invalidateQueries({ queryKey: ['leads', leadId] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not upload attachment');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
            Attachments
            {attachments.data?.length ? (
              <span className="num ml-1 font-normal text-muted-foreground">{attachments.data.length}</span>
            ) : null}
          </CardTitle>
          {canWrite ? (
            <>
              <input
                ref={inputRef}
                id={`lead-att-${leadId}`}
                type="file"
                accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp"
                className="sr-only"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <Button asChild size="sm" variant="secondary" loading={uploading}>
                <label htmlFor={`lead-att-${leadId}`} className="cursor-pointer">
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Upload
                </label>
              </Button>
            </>
          ) : null}
        </CardHeader>
        <CardBody>
          {attachments.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : attachments.isError ? (
            <p className="text-[12px] text-danger">Could not load attachments.</p>
          ) : attachments.data.length === 0 ? (
            <p className="text-helper">No files attached yet. PDF, DOCX, CSV, TXT, or images up to 10 MB.</p>
          ) : (
            <ul className="divide-y divide-border">
              {attachments.data.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.filename}</p>
                    <p className="text-helper num">
                      {formatBytes(a.sizeBytes)} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                  <a
                    href={`${API_URL}/leads/${leadId}/attachments/${a.id}/download`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Download ${a.filename}`}
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  {canWrite ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-danger"
                      aria-label={`Delete ${a.filename}`}
                      onClick={() => setDelTarget(a)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={delTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDelTarget(null);
        }}
        danger
        title="Delete attachment?"
        description={delTarget ? `"${delTarget.filename}" will be permanently removed.` : ''}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (delTarget) await remove.mutateAsync(delTarget.id);
        }}
      />
    </>
  );
}
