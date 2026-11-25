'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { api, type authApi } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';

function SsoCallbackHandler() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const code = params.get('code');
  const state = params.get('state');
  const idpError = params.get('error_description') ?? params.get('error');
  const paramError = idpError ?? (!code || !state ? 'Missing authorization code or state parameter from Identity Provider.' : null);

  useEffect(() => {
    if (paramError || !code || !state) return;

    let cancelled = false;
    void (async () => {
      try {
        const ctx = await api<Awaited<ReturnType<typeof authApi.me>>>('/auth/sso/callback/oidc', {
          method: 'POST',
          body: { code, state },
        });
        if (cancelled) return;
        qc.setQueryData(ME_KEY, ctx);
        router.replace('/dashboard');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Single Sign-On failed');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, state, paramError, qc, router]);

  const activeError = paramError ?? error;

  if (activeError) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 text-danger">
          <TriangleAlert className="h-5 w-5" aria-hidden />
        </div>
        <p className="text-[13px] text-danger">{activeError}</p>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <p className="text-[13px] text-muted-foreground">Completing Single Sign-On…</p>
    </div>
  );
}

export default function SsoCallbackPage() {
  return (
    <AuthLayout title="Signing you in" subtitle="Verifying your corporate identity.">
      <Suspense fallback={<div className="py-6 text-center text-[13px] text-muted-foreground">Loading…</div>}>
        <SsoCallbackHandler />
      </Suspense>
    </AuthLayout>
  );
}
