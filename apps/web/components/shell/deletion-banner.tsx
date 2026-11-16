'use client';

import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { BILLING_KEY } from './billing-banner';

/** While a workspace deletion is pending the whole workspace is read-only; say so, with the date and a way back. */
export function DeletionBanner() {
  const q = useQuery({ queryKey: BILLING_KEY, queryFn: () => api<{ pendingDeletionAt?: string | null; canManage?: boolean }>('/billing/summary'), staleTime: 60_000 });
  const at = q.data?.pendingDeletionAt;
  if (!at) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border bg-danger-soft px-4 py-2 text-[13px] text-danger sm:px-8">
      <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">This workspace is scheduled for permanent deletion on {new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} and is read-only until then.</span>
      <Link href="/settings" className="font-medium underline">Export data or cancel the deletion</Link>
    </div>
  );
}
