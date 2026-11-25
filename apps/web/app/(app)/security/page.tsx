'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { MfaPanel } from '@/components/security/mfa-panel';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const call = <T,>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => api<T>(`/security/mfa${path}`, { method, ...(body !== undefined ? { body } : {}) });

/** Workspace policy: owners can require two-step verification for every member. */
function WorkspacePolicy() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['security-workspace'], queryFn: () => api<{ requireMfa: boolean }>('/security/workspace'), retry: false });
  const set = useMutation({
    mutationFn: (requireMfa: boolean) => api('/security/workspace', { method: 'PUT', body: { requireMfa } }),
    onSuccess: () => { toast.success('Workspace policy updated'); void qc.invalidateQueries({ queryKey: ['security-workspace'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update'),
  });
  if (q.isError || !q.data) return null; // e.g. this member must enrol first: the workspace routes are held back until then
  return (
    <Card>
      <CardHeader><CardTitle>Workspace policy</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-[13px] text-muted-foreground">{q.data.requireMfa ? 'Every member must use two-step verification. Members who have not set it up are held at this page until they do.' : 'Two-step verification is optional for members of this workspace.'}</p>
        {can('settings:manage') ? (
          <Button variant={q.data.requireMfa ? 'secondary' : 'primary'} loading={set.isPending} onClick={() => set.mutate(!q.data.requireMfa)}>{q.data.requireMfa ? 'Stop requiring it' : 'Require for all members'}</Button>
        ) : <p className="text-helper">Only workspace owners can change this.</p>}
      </CardBody>
    </Card>
  );
}

export default function SecurityPage() {
  return (
    <>
      <PageHeader title="Security" description="Protect your account with a second sign-in step." />
      <div data-tour="security-mfa" className="max-w-2xl space-y-3">
        <MfaPanel call={call} queryKey={['security-mfa']} />
        <WorkspacePolicy />
      </div>
    </>
  );
}
