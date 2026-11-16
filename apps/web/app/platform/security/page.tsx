'use client';

import { MfaPanel } from '@/components/security/mfa-panel';
import { platformApi } from '@/lib/platform';

const call = <T,>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => platformApi<T>(`/security/mfa${path}`, { method, ...(body !== undefined ? { body } : {}) });

export default function PlatformSecurity() {
  return (
    <div className="max-w-2xl space-y-3">
      <div><h1 className="text-title">Security</h1><p className="text-helper mt-1">Two-step verification for your platform admin account.</p></div>
      <MfaPanel call={call} queryKey={['platform-mfa']} />
    </div>
  );
}
