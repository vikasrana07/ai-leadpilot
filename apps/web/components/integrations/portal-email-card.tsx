'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, MailCheck, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL, api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface PortalEmailConfigView {
  configured: boolean;
  enabled: boolean;
  endpointPath: string | null;
}

interface PortalEmailLogItem {
  id: string;
  portal: string;
  sender: string;
  subject: string;
  status: string;
  leadId: string | null;
  error: string | null;
  createdAt: string;
}

export function PortalEmailCard() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const cfg = useQuery({
    queryKey: ['integrations', 'portal-email'],
    queryFn: () => api<PortalEmailConfigView>('/integrations/portal-email'),
  });

  const logs = useQuery({
    queryKey: ['integrations', 'portal-email', 'logs'],
    queryFn: () => api<PortalEmailLogItem[]>('/integrations/portal-email/logs'),
    enabled: cfg.data?.configured === true,
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<PortalEmailConfigView>('/integrations/portal-email', { method: 'PUT', body: { enabled } }),
    onSuccess: async () => {
      toast.success('Portal email parsing updated');
      await qc.invalidateQueries({ queryKey: ['integrations', 'portal-email'] });
    },
    onError: (e) => handleApiError(e),
  });

  const rotate = useMutation({
    mutationFn: () => api<PortalEmailConfigView>('/integrations/portal-email/rotate-key', { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Webhook URL rotated');
      await qc.invalidateQueries({ queryKey: ['integrations', 'portal-email'] });
    },
    onError: (e) => handleApiError(e),
  });

  const fullUrl = cfg.data?.endpointPath ? `${API_URL}${cfg.data.endpointPath}` : null;

  return (
    <Card data-testid="portal-email-card">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="h-4 w-4 text-primary" aria-hidden />
            Portal email parsing
          </CardTitle>
          <p className="text-helper mt-0.5">
            Automatically capture leads from 99acres, Magicbricks, Housing.com, and NoBroker alert emails via SES SNS or inbound email webhooks.
          </p>
        </div>
        {cfg.data ? (
          <Badge tone={cfg.data.enabled && cfg.data.configured ? 'success' : 'neutral'}>
            {cfg.data.enabled && cfg.data.configured ? 'Active' : 'Off'}
          </Badge>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-4">
        {cfg.isPending ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={cfg.data?.enabled && cfg.data?.configured ? 'secondary' : 'primary'}
                size="sm"
                loading={toggle.isPending}
                onClick={() => toggle.mutate(!(cfg.data?.enabled && cfg.data?.configured))}
              >
                {cfg.data?.enabled && cfg.data?.configured ? 'Disable parsing' : 'Enable portal email parsing'}
              </Button>
              {cfg.data?.configured ? (
                <Button variant="ghost" size="sm" loading={rotate.isPending} onClick={() => rotate.mutate()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Rotate URL
                </Button>
              ) : null}
            </div>
            {fullUrl ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{fullUrl}</code>
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(fullUrl).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : null}
            {logs.data && logs.data.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-label text-muted-foreground">Recent parsed emails</p>
                <ul className="divide-y divide-border rounded-lg border border-border text-[12px]">
                  {logs.data.slice(0, 5).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.subject}</p>
                        <p className="text-helper truncate">
                          {l.portal} · {l.sender} · {timeAgo(l.createdAt)}
                        </p>
                      </div>
                      <Badge tone={l.status === 'IMPORTED' ? 'success' : 'neutral'}>{l.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
