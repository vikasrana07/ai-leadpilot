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
  const [challenge, setChallenge] = useState<string | null>(null); const [value, setValue] = useState(''); const [recovery, setRecovery] = useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm"><CardBody>
        <h1 className="text-title">Platform sign-in</h1>
        <p className="text-helper mb-4 mt-1">For LeadPilot staff. Workspace users sign in at the normal login.</p>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try {
            if (challenge) { await platformApi('/auth/mfa', { method: 'POST', body: { challengeToken: challenge, ...(recovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, '') }) } }); router.replace('/platform'); }
            else {
              const r = await platformApi<{ mfaRequired?: true; challengeToken?: string }>('/auth/login', { method: 'POST', body: { email, password } });
              if (r.mfaRequired && r.challengeToken) setChallenge(r.challengeToken); else router.replace('/platform');
            }
          }
          catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in'); } finally { setBusy(false); }
        }}>
          {challenge ? (
            <>
              <Field label={recovery ? 'Recovery code' : 'Authentication code'} htmlFor="pm" error={error ?? undefined}><Input id="pm" autoFocus autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} maxLength={recovery ? 16 : 7} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
              <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={value.trim().length < (recovery ? 8 : 6)}>Verify</Button>
              <div className="flex justify-between text-[13px]"><button type="button" className="text-primary underline underline-offset-2 hover:no-underline" onClick={() => { setRecovery(!recovery); setValue(''); setError(null); }}>{recovery ? 'Use authenticator code' : 'Use a recovery code'}</button><button type="button" className="text-muted-foreground hover:underline" onClick={() => { setChallenge(null); setValue(''); setError(null); }}>Back</button></div>
            </>
          ) : (
            <>
              <Field label="Email" htmlFor="pe"><Input id="pe" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
              <Field label="Password" htmlFor="pp" error={error ?? undefined}><Input id="pp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
              <Button type="submit" variant="primary" className="w-full" loading={busy}>Sign in</Button>
            </>
          )}
        </form>
      </CardBody></Card>
    </div>
  );
}
