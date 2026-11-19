'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { AuthProvider, useMe } from '@/lib/auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (me.isPending || unauthenticated) {
    return (
      <div className="flex h-dvh" aria-busy="true" aria-label="Loading">
        <div className="hidden shrink-0 bg-sidebar lg:block transition-none" style={{ width: 'var(--sidebar-width, 248px)' }} />
        <div className="flex-1 space-y-4 p-8"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      </div>
    );
  }
  if (me.isError) {
    return <div className="flex h-dvh items-center justify-center p-8 text-center"><div><p className="text-heading">We could not load your workspace</p><p className="text-helper mt-1">Check your connection and reload the page.</p></div></div>;
  }
  if (!me.data.activeTenantId) return <NoWorkspace />;
  return <AuthProvider ctx={me.data}><AppShell>{children}</AppShell></AuthProvider>;
}

/** The session exists but no workspace is active (e.g. after a membership was deactivated): pick the first available one. */
function NoWorkspace() {
  const me = useMe();
  const first = me.data?.workspaces[0];
  useEffect(() => {
    if (!first) return;
    void import('@/lib/api').then(({ authApi }) => authApi.switchWorkspace(first.tenantId)).then(() => me.refetch());
  }, [first, me]);
  return (
    <div className="flex h-dvh items-center justify-center p-8 text-center">
      <div><p className="text-heading">{first ? 'Opening your workspace…' : 'You do not belong to any active workspace'}</p>{first ? null : <p className="text-helper mt-1">Ask an owner to re-activate your access, or create a new workspace.</p>}</div>
    </div>
  );
}
