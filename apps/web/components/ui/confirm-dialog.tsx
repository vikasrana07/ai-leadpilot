'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, danger, onConfirm, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void>; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); } }}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
