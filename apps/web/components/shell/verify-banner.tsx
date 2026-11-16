'use client';

import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function VerifyEmailBanner() {
  const { ctx } = useAuth();
  const [busy, setBusy] = useState(false);
  if (ctx.user.emailVerified) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border bg-warning-soft px-4 py-2 text-[13px] text-warning sm:px-8">
      <MailWarning className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">Verify your email to invite teammates. We sent a link to {ctx.user.email}.</span>
      <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
        setBusy(true);
        try { await api('/auth/resend-verification', { method: 'POST' }); toast.success('Verification email sent'); } catch { toast.error('Could not send the email'); } finally { setBusy(false); }
      }}>Resend email</Button>
    </div>
  );
}
