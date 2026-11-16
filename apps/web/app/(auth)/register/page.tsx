'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@leadpilot/validation';
import { useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { useBotCheck } from '@/lib/turnstile';
import { handleApiError } from '@/lib/forms';
import type { AuthContextResponse } from '@leadpilot/shared-types';

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<z.input<typeof registerSchema>, unknown, RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { industry: 'real_estate' },
  });

  const bot = useBotCheck();
  async function onSubmit(values: RegisterInput) {
    try {
      const res = await api<AuthContextResponse | { message: string }>('/auth/register', { method: 'POST', body: values, ...(await bot.getToken().then((t) => (t ? { headers: { 'x-turnstile-token': t } } : {}))) });
      if ('user' in res) { qc.setQueryData(ME_KEY, res); router.replace('/onboarding'); }
      else setPending(true);
    } catch (e) { bot.reset(); handleApiError(e, setError); }
  }

  if (pending) {
    return (
      <AuthLayout title="Check your email" subtitle="We sent you a message to continue.">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4"><MailCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden /><p className="text-[13px] text-muted-foreground">If this email can be used for a new workspace you will be signed in. Otherwise, check your inbox, or <Link href="/login" className="text-primary hover:underline">sign in</Link>.</p></div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your workspace" subtitle="Start capturing and converting leads in minutes." footer={<>Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Your name" htmlFor="name" error={errors.name?.message}><Input id="name" autoComplete="name" autoFocus aria-invalid={!!errors.name} {...register('name')} /></Field>
        <Field label="Work email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} /></Field>
        <Field label="Business name" htmlFor="businessName" error={errors.businessName?.message}><Input id="businessName" autoComplete="organization" aria-invalid={!!errors.businessName} {...register('businessName')} /></Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters with upper, lower case and a number."><Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} /></Field>
        {bot.widget}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Create workspace</Button>
      </form>
    </AuthLayout>
  );
}
