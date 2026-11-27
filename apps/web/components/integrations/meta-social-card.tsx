'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareShare, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL, api } from '@/lib/api';
import { handleApiError } from '@/lib/forms';

interface SocialChannel {
  id: string;
  type: 'MESSENGER' | 'INSTAGRAM';
  name: string;
  status: string;
  externalId: string | null;
  webhookPath: string | null;
  verifyToken: string | null;
}

export function MetaSocialCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'MESSENGER' | 'INSTAGRAM'>('MESSENGER');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');

  const list = useQuery({
    queryKey: ['channels', 'meta-social'],
    queryFn: () => api<SocialChannel[]>('/channels/meta-social'),
  });

  const connect = useMutation({
    mutationFn: () =>
      api('/channels/meta-social', {
        method: 'POST',
        body: { type, name: name.trim(), externalId: externalId.trim(), accessToken: accessToken.trim(), appSecret: appSecret.trim() },
      }),
    onSuccess: async () => {
      toast.success('Social channel connected');
      setOpen(false);
      setName('');
      setExternalId('');
      setAccessToken('');
      setAppSecret('');
      await qc.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (e) => handleApiError(e),
  });

  const disable = useMutation({
    mutationFn: (id: string) => api(`/channels/meta-social/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Channel disabled');
      await qc.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareShare className="h-4 w-4 text-primary" aria-hidden />
              Messenger &amp; Instagram DMs
            </CardTitle>
            <p className="text-helper mt-0.5">Receive and reply to Facebook Page Messenger and Instagram direct messages in your Inbox.</p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Connect channel
          </Button>
        </CardHeader>
        <CardBody>
          {list.isPending ? (
            <Skeleton className="h-14" />
          ) : !list.data || list.data.length === 0 ? (
            <p className="text-helper">No Messenger or Instagram channels connected yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge tone="neutral">{c.type}</Badge>
                      <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status}</Badge>
                    </div>
                    {c.webhookPath ? (
                      <p className="text-helper mt-0.5 truncate font-mono text-[11px]">
                        Webhook: {API_URL}{c.webhookPath} · Verify token: {c.verifyToken}
                      </p>
                    ) : null}
                  </div>
                  {c.status === 'ACTIVE' ? (
                    <Button size="icon" variant="ghost" className="text-danger hover:text-danger" aria-label={`Disable ${c.name}`} onClick={() => disable.mutate(c.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Connect Messenger or Instagram" description="Enter your Meta Page / Instagram Account credentials.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
            <Field label="Channel" htmlFor="ms-type">
              <Select id="ms-type" value={type} onChange={(e) => setType(e.target.value as 'MESSENGER' | 'INSTAGRAM')}>
                <option value="MESSENGER">Facebook Messenger</option>
                <option value="INSTAGRAM">Instagram Direct</option>
              </Select>
            </Field>
            <Field label="Display name" htmlFor="ms-name">
              <Input id="ms-name" required placeholder="e.g. Official Facebook Page" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={type === 'INSTAGRAM' ? 'Instagram Account ID' : 'Facebook Page ID'} htmlFor="ms-ext">
              <Input id="ms-ext" required value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </Field>
            <Field label="Page Access Token" htmlFor="ms-tok">
              <Input id="ms-tok" required type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
            </Field>
            <Field label="Meta App Secret" htmlFor="ms-sec">
              <Input id="ms-sec" required type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={connect.isPending}>Connect</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
