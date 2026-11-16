'use client';

import type { AuthContextResponse } from '@leadpilot/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { ApiError, authApi } from './api';

interface AuthValue {
  ctx: AuthContextResponse;
  can: (permission: string) => boolean;
  activeWorkspace: AuthContextResponse['workspaces'][number] | undefined;
  switchWorkspace: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: authApi.me,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

export function AuthProvider({ ctx, children }: { ctx: AuthContextResponse; children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();

  const switchWorkspace = useCallback(async (tenantId: string) => {
    const next = await authApi.switchWorkspace(tenantId);
    // Everything cached belongs to the previous workspace: drop it all.
    qc.clear();
    qc.setQueryData(ME_KEY, next);
    router.refresh();
  }, [qc, router]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } finally {
      qc.clear();
      router.replace('/login');
    }
  }, [qc, router]);

  const value = useMemo<AuthValue>(() => {
    const perms = new Set(ctx.permissions);
    return {
      ctx,
      can: (p) => perms.has(p),
      activeWorkspace: ctx.workspaces.find((w) => w.tenantId === ctx.activeTenantId),
      switchWorkspace,
      logout,
    };
  }, [ctx, switchWorkspace, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside the authenticated app shell');
  return v;
}
