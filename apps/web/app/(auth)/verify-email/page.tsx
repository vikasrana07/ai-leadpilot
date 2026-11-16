'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  // Verification tokens are single-use: never retry, and keep the result for the lifetime of the page.
  const q = useQuery({ queryKey: ['verify-email', token], queryFn: () => api<void>('/auth/verify-email', { method: 'POST', body: { token } }), enabled: !!token, retry: false, staleTime: Infinity, refetchOnMount: false });
  if (!token || q.isError) return <div className="flex gap-3"><XCircle className="h-5 w-5 text-danger" aria-hidden /><div><p className="text-[13px]">This verification link is invalid or has expired.</p><Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/login">Go to sign in</Link></Button></div></div>;
  if (q.isPending) return <Skeleton className="h-10" />;
  return <div className="flex gap-3"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /><div><p className="text-[13px]">Your email is verified.</p><Button asChild variant="primary" size="sm" className="mt-4"><Link href="/dashboard">Continue</Link></Button></div></div>;
}

export default function VerifyEmailPage() {
  return <AuthLayout title="Verifying your email"><Suspense><Verify /></Suspense></AuthLayout>;
}
