'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { platformApi } from '@/lib/platform';

const NAV = [{ href: '/platform', label: 'Overview' }, { href: '/platform/tenants', label: 'Tenants' }, { href: '/platform/plans', label: 'Plans' }, { href: '/platform/deletions', label: 'Deletion requests' }, { href: '/platform/audit', label: 'Audit log' }, { href: '/platform/security', label: 'Security' }];

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isLogin = pathname.startsWith('/platform/login');
  const me = useQuery({ queryKey: ['platform-me'], queryFn: () => platformApi<{ admin: { email: string; name: string } }>('/me'), enabled: !isLogin, retry: false });
  if (isLogin) return <>{children}</>;
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-2.5">
          <span className="text-[14px] font-semibold">LeadPilot Platform</span>
          <nav aria-label="Platform" className="flex flex-1 flex-wrap gap-1">
            {NAV.map((n) => { const active = n.href === '/platform' ? pathname === n.href : pathname.startsWith(n.href); return <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cn('rounded-md px-2.5 py-2 text-[13px] sm:py-1 hover:bg-white/10', active && 'bg-white/15 font-medium')}>{n.label}</Link>; })}
          </nav>
          <span className="text-[12px] opacity-80">{me.data?.admin.email}</span>
          <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-white/10" onClick={async () => { await platformApi('/auth/logout', { method: 'POST' }).catch(() => undefined); qc.clear(); router.replace('/platform/login'); }}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{me.isPending ? <p className="text-helper">Loading…</p> : children}</main>
    </div>
  );
}
