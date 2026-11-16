'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Globe, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';

interface WidgetCfg { publicKey: string; allowedOrigins: string[]; enabled: boolean; theme: { color?: string; position?: string }; title: string; greeting: string; scriptUrl: string }

export function WidgetCard() {
  const cfg = useQuery({ queryKey: ['widget-config'], queryFn: () => api<WidgetCfg | null>('/widget-config') });
  if (cfg.isPending) return <Card><CardBody><Skeleton className="h-32" /></CardBody></Card>;
  // Keyed so the form's initial values come from the saved config (no state-syncing effect).
  return <WidgetEditor key={cfg.data?.publicKey ?? 'new'} data={cfg.data ?? null} />;
}

function WidgetEditor({ data }: { data: WidgetCfg | null }) {
  const qc = useQueryClient();
  const cfg = { data, isPending: false };
  const [f, setF] = useState({ origins: data?.allowedOrigins.join('\n') ?? '', color: data?.theme.color ?? '#3f55e8', position: data?.theme.position ?? 'right', title: data?.title ?? 'Chat with us', greeting: data?.greeting ?? 'Hi! How can we help you today?', enabled: data?.enabled ?? true });
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api<WidgetCfg>('/widget-config', { method: 'PUT', body: { allowedOrigins: f.origins.split(/[\s,]+/).filter(Boolean), color: f.color, position: f.position, title: f.title, greeting: f.greeting, enabled: f.enabled } }),
    onSuccess: async () => { setErr(null); toast.success('Widget saved'); await qc.invalidateQueries({ queryKey: ['widget-config'] }); },
    onError: (e) => setErr(e instanceof ApiError ? (e.details?.map((d) => d.message).join(' ') ?? e.message) : 'Could not save'),
  });
  const rotate = useMutation({ mutationFn: () => api('/widget-config/rotate-key', { method: 'POST' }), onSuccess: async () => { toast.success('New key created. Update the snippet on your website.'); await qc.invalidateQueries({ queryKey: ['widget-config'] }); } });
  const snippet = cfg.data ? `<script src="${cfg.data.scriptUrl}" data-key="${cfg.data.publicKey}" async></script>` : '';

  return (
    <Card>
      <CardHeader><div><CardTitle><Globe className="mr-1.5 inline h-4 w-4" aria-hidden />Website chat widget</CardTitle><p className="text-helper mt-0.5">A chat bubble for your website. Visitors share a phone or email, and the conversation lands in your Inbox.</p></div>{cfg.data ? <Badge tone={cfg.data.enabled ? 'success' : 'neutral'}>{cfg.data.enabled ? 'Live' : 'Off'}</Badge> : null}</CardHeader>
      <CardBody className="space-y-5">
        {cfg.isPending ? <Skeleton className="h-32" /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Websites allowed to show the widget" htmlFor="w-origins" className="sm:col-span-2" hint="One address per line, like https://www.yourcompany.com. Other sites cannot use your widget."><Textarea id="w-origins" className="min-h-16" value={f.origins} onChange={(e) => setF({ ...f, origins: e.target.value })} /></Field>
              <Field label="Title" htmlFor="w-title"><Input id="w-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Colour" htmlFor="w-color"><div className="flex gap-2"><input id="w-color" type="color" aria-label="Widget colour" className="h-9 w-12 rounded-md border border-border bg-surface" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /><Input aria-label="Colour hex code" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></div></Field>
              <Field label="Greeting" htmlFor="w-greeting" className="sm:col-span-2"><Input id="w-greeting" value={f.greeting} onChange={(e) => setF({ ...f, greeting: e.target.value })} /></Field>
              <Field label="Position" htmlFor="w-pos"><Select id="w-pos" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}><option value="right">Bottom right</option><option value="left">Bottom left</option></Select></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Widget is on</label>
            </div>
            {err ? <p role="alert" className="text-[13px] text-danger">{err}</p> : null}
            <div className="flex gap-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{cfg.data ? 'Save changes' : 'Create widget'}</Button>{cfg.data ? <Button onClick={() => rotate.mutate()} loading={rotate.isPending}><RefreshCw className="h-3.5 w-3.5" aria-hidden />New key</Button> : null}</div>
            {cfg.data ? (
              <div>
                <p className="text-label mb-1">Install: paste before &lt;/body&gt; on your website</p>
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-2.5"><code className="min-w-0 flex-1 break-all font-mono text-[12px]">{snippet}</code><Button size="sm" variant="ghost" aria-label="Copy snippet" onClick={() => void navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}</Button></div>
                <p className="text-helper mt-1.5">The key is public by design. It only works on the websites listed above, and visitors never see any private credentials.</p>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
