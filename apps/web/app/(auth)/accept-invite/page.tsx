'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { acceptInviteSchema, type AcceptInviteInput } from '@leadpilot/validation';
import type { AuthContextResponse } from '@leadpilot/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

interface Preview { email: string; workspace: string; role: string; hasAccount: boolean }

function Accept() {
  const router = useRouter();
  const qc = useQueryClient();
  const token = useSearchParams().get('token') ?? '';
  const preview = useQuery({ queryKey: ['invite', token], enabled: !!token, retry: false, queryFn: () => api<Preview>('/auth/invitations/preview', { method: 'POST', body: { token } }) });
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<AcceptInviteInput>({ resolver: zodResolver(acceptInviteSchema), defaultValues: { token } });

  async function onSubmit(values: AcceptInviteInput) {
    try {
      const ctx = await api<AuthContextResponse>('/auth/invitations/accept', { method: 'POST', body: { ...values, token } });
      qc.setQueryData(ME_KEY, ctx);
      router.replace('/dashboard');
    } catch (e) { handleApiError(e, setError); }
  }

  if (!token || preview.isError) return <p className="text-[13px] text-danger">This invitation is invalid or has expired. Ask your admin to send a new one.</p>;
  if (preview.isPending) return <div className="space-y-3"><Skeleton className="h-6" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>;
  const p = preview.data;

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-border bg-surface p-4 text-[13px]">You have been invited to <strong>{p.workspace}</strong> as <strong>{p.role}</strong> ({p.email}).</p>
      {p.hasAccount ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">You already have an account. Sign in as {p.email}, then accept.</p>
          <div className="flex gap-2">
            <Button asChild variant="secondary"><Link href={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>Sign in</Link></Button>
            <Button variant="primary" loading={isSubmitting} onClick={() => void handleSubmit(onSubmit)()}>Accept invitation</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Your name" htmlFor="name" error={errors.name?.message}><Input id="name" autoComplete="name" autoFocus {...register('name')} /></Field>
          <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters with upper, lower case and a number."><Input id="password" type="password" autoComplete="new-password" {...register('password')} /></Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Join workspace</Button>
        </form>
      )}
    </div>
  );
}

export default function AcceptInvitePage() {
  return <AuthLayout title="Join your team"><Suspense><Accept /></Suspense></AuthLayout>;
}
