'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { WhatsappCard } from '@/components/integrations/whatsapp-card';
import { WidgetCard } from '@/components/integrations/widget-card';
import { GoogleCalendarCard } from '@/components/integrations/google-calendar-card';
import { SesCard } from '@/components/integrations/ses-card';
import { PageHeader } from '@/components/page/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/pack';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface Key { id: string; name: string; keyPrefix: string; lastUsedAt: string | null; createdAt: string }

export default function IntegrationsPage() {
  const { can } = useAuth();
  const terms = useTerms();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api<Key[]>('/api-keys'), enabled: can('integration:manage') });
  const [name, setName] = useState(''); const [fresh, setFresh] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  const create = useMutation({ mutationFn: (n: string) => api<{ key: string }>('/api-keys', { method: 'POST', body: { name: n } }), onSuccess: async (r) => { setFresh(r.key); setName(''); await qc.invalidateQueries({ queryKey: ['api-keys'] }); }, onError: (e) => handleApiError(e) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }), onSuccess: async () => { toast.success('Key revoked'); await qc.invalidateQueries({ queryKey: ['api-keys'] }); }, onError: (e) => handleApiError(e) });
  const curl = `curl -X POST ${API_URL}/public/leads \\\n  -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \\\n  -d '{"name":"Asha Verma","phone":"9876543210","message":"Interested in 3BHK"}'`;

  return (
    <>
      <PageHeader title="Integrations" description={`Connect the places your ${terms.leads} come from.`} />
      {can('integration:manage') ? (
        <div data-tour="integrations-cards" className="mb-6 space-y-6">
          <WhatsappCard />
          <WidgetCard />
          <SesCard />
        </div>
      ) : null}
      <GoogleCalendarCard />

      <Card>
        <CardHeader><div><CardTitle><KeyRound className="mr-1.5 inline h-4 w-4" aria-hidden />{terms.Lead} capture API</CardTitle><p className="text-helper mt-0.5">Send {terms.leads} from your website form, ad platform or any backend. Keep keys secret: call this from a server, never from browser code.</p></div></CardHeader>
        <CardBody className="space-y-5">
          {!can('integration:manage') ? <p className="text-helper">Only workspace owners can manage API keys.</p> : (
            <>
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}><Input aria-label="Key name" className="max-w-xs" placeholder="e.g. Website contact form" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}><Plus className="h-4 w-4" aria-hidden />Create key</Button></form>
              {keys.isPending ? <Skeleton className="h-12" /> : keys.data && keys.data.length > 0 ? (
                <ul className="divide-y divide-border rounded-lg border border-border">{keys.data.map((k) => <li key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]"><div className="flex-1"><p className="font-medium">{k.name}</p><p className="text-helper num">{k.keyPrefix}… · created {timeAgo(k.createdAt)} · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}</p></div><Button variant="ghost" size="icon" aria-label={`Revoke ${k.name}`} onClick={() => revoke.mutate(k.id)}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>
              ) : <p className="text-helper">No API keys yet.</p>}
              <div><p className="text-label mb-1.5">Example</p><pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12px] leading-5">{curl}</pre><p className="text-helper mt-1.5">Repeat enquiries from the same phone or email are added to the existing {terms.lead} instead of creating a duplicate.</p></div>
            </>
          )}
        </CardBody>
      </Card>

      <Dialog open={fresh !== null} onOpenChange={(o) => { if (!o) { setFresh(null); setCopied(false); } }}>
        <DialogContent title="Copy your API key" description="This is the only time the full key is shown. Store it somewhere safe.">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5"><code className="min-w-0 flex-1 break-all font-mono text-[12px]">{fresh}</code><Button size="sm" onClick={() => { if (fresh) void navigator.clipboard.writeText(fresh).then(() => setCopied(true)); }}>{copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}{copied ? 'Copied' : 'Copy'}</Button></div>
          <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => { setFresh(null); setCopied(false); }}>Done</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
