'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';

export interface MfaStatus { enabled: boolean; enrollmentPending: boolean; recoveryCodesRemaining: number; workspaceRequiresMfa?: boolean }
type Call = <T>(path: string, method?: 'GET' | 'POST', body?: unknown) => Promise<T>;

/**
 * Two-step verification set-up, shared by the workspace Security page and the platform console.
 * The secret and recovery codes are shown once; there is no QR image (type the key into any authenticator app, or open the otpauth link).
 */
export function MfaPanel({ call, queryKey }: { call: Call; queryKey: string[] }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey, queryFn: () => call<MfaStatus>('') });
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState('');
  const [action, setAction] = useState<null | 'disable' | 'regenerate'>(null);
  const [proof, setProof] = useState(''); const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey });

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); return undefined; } finally { setBusy(false); }
  }
  const proofBody = () => (useRecovery ? { recoveryCode: proof.trim() } : { code: proof.replace(/\s/g, '') });

  if (status.isPending) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-44" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </CardHeader>
        <CardBody className="space-y-3">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <div className="pt-2">
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </CardBody>
      </Card>
    );
  }
  if (status.isError) return <Card><CardBody><p className="text-helper">Could not load your security settings.</p></CardBody></Card>;
  const s = status.data;

  if (codes) {
    const text = `LeadPilot recovery codes\n\n${codes.join('\n')}\n\nEach code works once.`;
    return (
      <Card><CardHeader><CardTitle>Save your recovery codes</CardTitle></CardHeader><CardBody className="space-y-3">
        <p className="text-[13px] text-muted-foreground">If you lose your phone, each of these signs you in once. <strong>They are shown only now.</strong> Store them somewhere safe, like a password manager.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 font-mono text-[13px]" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard.writeText(text); toast.success('Copied'); }}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
          <Button variant="secondary" size="sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'leadpilot-recovery-codes.txt'; a.click(); }}><Download className="h-4 w-4" aria-hidden /> Download</Button>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes</label>
        <Button variant="primary" disabled={!saved} onClick={() => { setCodes(null); setSaved(false); void refresh(); }}>Done</Button>
      </CardBody></Card>
    );
  }

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><CardTitle>Two-step verification</CardTitle>{s.enabled ? <Badge tone="success"><ShieldCheck className="h-3 w-3" aria-hidden /> On</Badge> : <Badge>Off</Badge>}</div></CardHeader>
      <CardBody className="space-y-3">
        {!s.enabled && !setup ? (
          <>
            <p className="text-[13px] text-muted-foreground">Add a second step to sign-in with an authenticator app (Google Authenticator, Authy, 1Password…). A stolen password alone is then not enough.</p>
            {s.workspaceRequiresMfa ? <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">Your workspace requires two-step verification. Set it up to continue using LeadPilot.</p> : null}
            <Button variant="primary" loading={busy} onClick={async () => { const r = await run(() => call<{ secret: string; otpauthUri: string }>('/enroll', 'POST', {})); if (r) { setSetup(r); setCode(''); } }}>Set up</Button>
          </>
        ) : null}

        {!s.enabled && setup ? (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => call<{ recoveryCodes: string[] }>('/confirm', 'POST', { code: code.replace(/\s/g, '') })); if (r) { setSetup(null); setCodes(r.recoveryCodes); } }}>
            <p className="text-[13px] text-muted-foreground">1. In your authenticator app choose “enter a setup key” and type this key (or <a className="text-primary underline" href={setup.otpauthUri}>open it in an app on this device</a>):</p>
            <p className="select-all break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[14px] tracking-wider" aria-label="Setup key">{setup.secret}</p>
            <Field label="2. Enter the 6-digit code it shows" htmlFor="mfa-confirm" error={error ?? undefined}><Input id="mfa-confirm" autoComplete="one-time-code" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <div className="flex gap-2"><Button type="submit" variant="primary" loading={busy} disabled={code.replace(/\s/g, '').length !== 6}>Turn on</Button><Button type="button" variant="ghost" onClick={() => { setSetup(null); setError(null); void refresh(); }}>Cancel</Button></div>
          </form>
        ) : null}

        {s.enabled && !action ? (
          <>
            <p className="text-[13px] text-muted-foreground">Sign-in asks for a code from your authenticator app. You have <strong>{s.recoveryCodesRemaining}</strong> unused recovery code{s.recoveryCodesRemaining === 1 ? '' : 's'}.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setAction('regenerate'); setProof(''); setError(null); }}>New recovery codes</Button>
              <Button variant="danger" onClick={() => { setAction('disable'); setProof(''); setError(null); }} disabled={s.workspaceRequiresMfa}>Turn off</Button>
            </div>
            {s.workspaceRequiresMfa ? <p className="text-helper">Your workspace requires two-step verification, so it cannot be turned off.</p> : null}
          </>
        ) : null}

        {s.enabled && action ? (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (action === 'disable') { const ok = await run(async () => { await call('/disable', 'POST', proofBody()); return true; }); if (ok) { toast.success('Two-step verification is off'); setAction(null); void refresh(); } }
            else { const r = await run(() => call<{ recoveryCodes: string[] }>('/recovery-codes', 'POST', proofBody())); if (r) { setAction(null); setCodes(r.recoveryCodes); } }
          }}>
            <p className="text-[13px] text-muted-foreground">{action === 'disable' ? 'Confirm with a current code to turn two-step verification off.' : 'Confirm with a current code. Your old recovery codes will stop working.'}</p>
            <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} htmlFor="mfa-proof" error={error ?? undefined}><Input id="mfa-proof" autoFocus autoComplete="one-time-code" value={proof} onChange={(e) => setProof(e.target.value)} maxLength={useRecovery ? 16 : 7} inputMode={useRecovery ? 'text' : 'numeric'} /></Field>
            <button type="button" className="text-[13px] text-primary underline underline-offset-2 hover:no-underline" onClick={() => { setUseRecovery(!useRecovery); setProof(''); }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>
            <div className="flex gap-2"><Button type="submit" variant={action === 'disable' ? 'danger' : 'primary'} loading={busy} disabled={proof.trim().length < (useRecovery ? 8 : 6)}>{action === 'disable' ? 'Turn off' : 'Generate codes'}</Button><Button type="button" variant="ghost" onClick={() => { setAction(null); setError(null); }}>Cancel</Button></div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
