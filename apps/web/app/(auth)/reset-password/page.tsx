'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@leadpilot/validation';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { handleApiError } from '@/lib/forms';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Values = z.infer<typeof schema>;

function Form() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });
  async function onSubmit(v: Values) {
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } });
      toast.success('Password updated. Please sign in.');
      router.replace('/login');
    } catch (e) { handleApiError(e); }
  }
  if (!token) return <p className="text-[13px] text-danger">This link is missing its token. <Link href="/forgot-password" className="text-primary hover:underline">Request a new one</Link>.</p>;
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="New password" htmlFor="password" error={errors.password?.message}><Input id="password" type="password" autoComplete="new-password" autoFocus {...register('password')} /></Field>
      <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}><Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} /></Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return <AuthLayout title="Choose a new password" subtitle="You will be signed out of every device."><Suspense><Form /></Suspense></AuthLayout>;
}
