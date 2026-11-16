'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@leadpilot/validation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get('next');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    try {
      const ctx = await authApi.login(values);
      qc.setQueryData(ME_KEY, ctx);
      router.replace(next && /^\/(?![/\\])/.test(next) ? next : '/dashboard');
    } catch (e) { handleApiError(e); }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...register('email')} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
      </Field>
      <div className="flex justify-end"><Link href="/forgot-password" className="text-[13px] text-primary hover:underline">Forgot password?</Link></div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace." footer={<>New to LeadPilot? <Link href="/register" className="text-primary hover:underline">Create an account</Link></>}>
      <Suspense><LoginForm /></Suspense>
    </AuthLayout>
  );
}
