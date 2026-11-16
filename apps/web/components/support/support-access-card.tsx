'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

/** Workspace owners decide whether LeadPilot staff may ever open a read-only support session here. */
export function SupportAccessCard() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['support-access'], queryFn: () => api<{ enabled: boolean }>('/support-access'), enabled: can('settings:manage') });
  const set = useMutation({ mutationFn: (enabled: boolean) => api('/support-access', { method: 'PUT', body: { enabled } }), onSuccess: async (_r, enabled) => { toast.success(enabled ? 'Support access allowed' : 'Support access switched off. Open sessions ended.'); await qc.invalidateQueries({ queryKey: ['support-access'] }); }, onError: (e) => handleApiError(e) });
  if (!can('settings:manage')) return null;
  const on = q.data?.enabled ?? true;
  return (
    <Card>
      <CardHeader><CardTitle><LifeBuoy className="mr-1.5 inline h-4 w-4" aria-hidden />Support access</CardTitle><Badge tone={on ? 'warning' : 'success'}>{on ? 'Allowed' : 'Off'}</Badge></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-helper">When you ask for help, LeadPilot support may open a <strong>read-only</strong> session of up to 30 minutes. They need a written reason, cannot change anything, cannot see team, billing, integration or API details, and every action is recorded in your Audit log. You are notified when a session starts and ends. You can switch this off entirely.</p>
        <Button disabled={q.isPending || set.isPending} variant={on ? 'danger' : 'primary'} onClick={() => { if (!on || window.confirm('Switch support access off? Any open support session ends immediately, and LeadPilot cannot help with problems by looking at your workspace.')) set.mutate(!on); }}>{on ? 'Switch support access off' : 'Allow support access'}</Button>
      </CardBody>
    </Card>
  );
}
