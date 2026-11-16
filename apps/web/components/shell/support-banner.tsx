'use client';

import { useMutation } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSupportSession } from '@/lib/support';

/** Shown for as long as a LeadPilot support session is open in this browser. It cannot be dismissed; the only way out is to end the session. */
export function SupportBanner() {
  const q = useSupportSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const end = useMutation({ mutationFn: () => api('/support-session/end', { method: 'POST' }), onSuccess: () => window.location.assign('/platform'), onError: () => toast.error('Could not end the session. Close this tab; it expires on its own.') });
  const s = q.data;
  if (!s?.active) return null;
  const left = Math.max(0, Math.round((new Date(s.expiresAt ?? 0).getTime() - now) / 60_000));
  return (
    <div role="alert" aria-live="polite" className="sticky top-0 z-50 flex flex-wrap items-center gap-3 bg-[#b91c1c] px-4 py-2 text-[13px] text-white">
      <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1"><strong>LeadPilot support session (read-only).</strong> {s.adminName} is viewing this workspace. Reason: {s.reason}. {left} min left. Nothing can be changed.</p>
      <Button size="sm" onClick={() => end.mutate()} disabled={end.isPending}>End session</Button>
    </div>
  );
}
