'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@leadpilot/validation';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useBotCheck } from '@/lib/turnstile';
import { handleApiError } from '@/lib/forms';

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const bot = useBotCheck();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) });
  async function onSubmit(values: Values) {
    try { const t = await bot.getToken(); await api('/auth/forgot-password', { method: 'POST', body: values, ...(t ? { headers: { 'x-turnstile-token': t } } : {}) }); setSent(true); } catch (e) { bot.reset(); handleApiError(e); }
  }
  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new one." footer={<Link href="/login" className="text-primary underline underline-offset-2 hover:no-underline">Back to sign in</Link>}>
      {sent ? (
        <p role="status" className="rounded-lg border border-border bg-surface p-4 text-[13px] text-muted-foreground">If an account exists for that email, a reset link is on its way. It expires in one hour.</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="email" autoFocus {...register('email')} /></Field>
          {bot.widget}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}
