'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/platform/platform-shell';
import { platformApi } from '@/lib/platform';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname.startsWith('/platform/login');
  const me = useQuery({
    queryKey: ['platform-me'],
    queryFn: () => platformApi<{ admin: { email: string; name: string } }>('/me'),
    enabled: !isLogin,
    retry: false,
  });

  if (isLogin) return <>{children}</>;

  return (
    <PlatformShell admin={me.data?.admin} isLoading={me.isPending}>
      {children}
    </PlatformShell>
  );
}
