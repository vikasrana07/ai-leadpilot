'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface DeletionStatus { status: 'received' | 'completed'; receivedAt: string; message: string }

/**
 * Public page that Meta links a person to after a data-deletion request (WhatsApp Embedded Signup, ADR 0012). The confirmation code in the
 * address is the only key; the page shows the status and what LeadPilot does and does not hold. No sign-in.
 */
function Status() {
  const code = useSearchParams().get('code') ?? '';
  const q = useQuery({ queryKey: ['data-deletion', code], queryFn: () => api<DeletionStatus>(`/webhooks/meta/data-deletion/${encodeURIComponent(code)}`), enabled: code.length > 0, retry: false });
  if (!code) return <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-[13px] text-muted-foreground">This page needs the confirmation code from your request. Open the link you were given.</p>;
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.isError) return <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-[13px] text-muted-foreground">We could not find a request with that code. Check the link, or contact the business that asked you to connect WhatsApp.</p>;
  const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(q.data.receivedAt));
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-[13px]">
      <p className="text-heading">{q.data.status === 'completed' ? 'Completed' : 'Received'}</p>
      <p className="text-helper">Request received on {when}</p>
      <p className="text-muted-foreground">{q.data.message}</p>
      <p className="text-helper num">Confirmation code: <span className="font-mono">{code}</span></p>
    </div>
  );
}

export default function DataDeletionPage() {
  return (
    <AuthLayout title="Data deletion request" subtitle="Status of a request made through Facebook.">
      <Suspense fallback={<Skeleton className="h-24" />}><Status /></Suspense>
    </AuthLayout>
  );
}
