'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform';

export default function PlatformLogin() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm"><CardBody>
        <h1 className="text-title">Platform sign-in</h1>
        <p className="text-helper mb-4 mt-1">For LeadPilot staff. Workspace users sign in at the normal login.</p>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try { await platformApi('/auth/login', { method: 'POST', body: { email, password } }); router.replace('/platform'); }
          catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in'); } finally { setBusy(false); }
        }}>
          <Field label="Email" htmlFor="pe"><Input id="pe" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
          <Field label="Password" htmlFor="pp" error={error ?? undefined}><Input id="pp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Sign in</Button>
        </form>
      </CardBody></Card>
    </div>
  );
}
