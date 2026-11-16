'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@leadpilot/validation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi, type MfaChallenge } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';
import { useBotCheck } from '@/lib/turnstile';

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get('next');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const bot = useBotCheck();
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const done = (ctx: Awaited<ReturnType<typeof authApi.me>>) => {
    qc.setQueryData(ME_KEY, ctx);
    router.replace(next && /^\/(?![/\\])/.test(next) ? next : '/dashboard');
  };

  async function onSubmit(values: LoginInput) {
    try {
      const r = await authApi.login(values, await bot.getToken());
      if ('mfaRequired' in r) setChallenge(r); else done(r);
    } catch (e) { bot.reset(); handleApiError(e); }
  }

  if (challenge) return <MfaStep challenge={challenge} onDone={done} onBack={() => setChallenge(null)} />;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...register('email')} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
      </Field>
      {bot.widget}
      <div className="flex justify-end"><Link href="/forgot-password" className="text-[13px] text-primary underline underline-offset-2 hover:no-underline">Forgot password?</Link></div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
    </form>
  );
}

/** Second sign-in step: a 6-digit authenticator code, or a one-time recovery code. */
function MfaStep({ challenge, onDone, onBack }: { challenge: MfaChallenge; onDone: (ctx: Awaited<ReturnType<typeof authApi.me>>) => void; onBack: () => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try { onDone(await authApi.mfaVerify({ challengeToken: challenge.challengeToken, ...(useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, '') }) })); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not verify the code'); } finally { setBusy(false); }
    }}>
      <p className="text-[13px] text-muted-foreground">{useRecovery ? 'Enter one of your recovery codes. Each one works once.' : 'Open your authenticator app and enter the 6-digit code for LeadPilot.'}</p>
      <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} htmlFor="mfa-code" error={error ?? undefined}>
        <Input id="mfa-code" autoFocus autoComplete="one-time-code" inputMode={useRecovery ? 'text' : 'numeric'} maxLength={useRecovery ? 16 : 7} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={value.trim().length < (useRecovery ? 8 : 6)}>Verify</Button>
      <div className="flex justify-between text-[13px]">
        <button type="button" className="text-primary underline underline-offset-2 hover:no-underline" onClick={() => { setUseRecovery(!useRecovery); setValue(''); setError(null); }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={onBack}>Back</button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace." footer={<>New to LeadPilot? <Link href="/register" className="text-primary underline underline-offset-2 hover:no-underline">Create an account</Link></>}>
      <Suspense><LoginForm /></Suspense>
    </AuthLayout>
  );
}
