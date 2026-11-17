import { AlertTriangle, SearchX } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

/**
 * Full-page message used by the error boundary and the 404 page. Plain, calm copy; the reference id (request id or Next digest) lets
 * someone report the problem and have it found in the server logs. Presentational, so it renders on the server and in tests.
 */
export function ErrorView({ kind, reference, onRetry }: { kind: 'error' | 'not-found'; reference?: string | undefined; onRetry?: (() => void) | undefined }) {
  const Icon = kind === 'error' ? AlertTriangle : SearchX;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-center text-foreground">
      <Logo />
      <div className="flex w-full max-w-md flex-col items-center rounded-xl border border-border bg-surface px-6 py-10 shadow-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background"><Icon className="h-6 w-6 text-muted-foreground" aria-hidden /></div>
        <h1 className="text-heading">{kind === 'error' ? 'Something went wrong' : 'We could not find that page'}</h1>
        <p className="text-helper mt-1 max-w-sm">
          {kind === 'error' ? 'This was not your fault. Your data is safe. Try again, and if it keeps happening contact support with the reference below.' : 'The link may be old or mistyped. Go back to your dashboard and try again.'}
        </p>
        {reference ? <p className="text-helper mt-3">Reference: <code className="num rounded bg-muted px-1.5 py-0.5 text-foreground">{reference}</code></p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? <Button variant="primary" onClick={onRetry}>Try again</Button> : null}
          <Button asChild variant={onRetry ? 'secondary' : 'primary'}><Link href="/dashboard">Go to dashboard</Link></Button>
        </div>
      </div>
    </main>
  );
}

/** The most useful id on an error: our API's request id, else Next's server-error digest. */
export function errorReference(error: unknown): string | undefined {
  const e = error as { requestId?: unknown; digest?: unknown } | null | undefined;
  if (typeof e?.requestId === 'string' && e.requestId) return e.requestId;
  if (typeof e?.digest === 'string' && e.digest) return e.digest;
  return undefined;
}
