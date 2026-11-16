'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { channelWhatsappSchema, templateSchema } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Copy, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import type { WaTemplate } from '@/lib/inbox';

interface Channel { id: string; name: string; status: 'ACTIVE' | 'DISABLED' | 'ERROR'; phoneNumberId: string; displayPhone: string | null; webhookUrl: string; verifyToken: string; lastVerifiedAt: string | null }
type ConnectForm = z.infer<typeof channelWhatsappSchema>;
type TemplateForm = z.input<typeof templateSchema>;

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <p className="text-label mb-1">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5"><code className="min-w-0 flex-1 break-all font-mono text-[12px]">{value}</code><Button size="sm" variant="ghost" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>{done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}</Button></div>
    </div>
  );
}

function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<ConnectForm>({ resolver: zodResolver(channelWhatsappSchema), defaultValues: { name: 'Main WhatsApp number' } });
  async function onSubmit(v: ConnectForm) {
    try { await api('/channels/whatsapp', { method: 'POST', body: v }); toast.success('WhatsApp connected. Now add the webhook in Meta (steps below).'); await qc.invalidateQueries({ queryKey: ['channels'] }); reset(); onOpenChange(false); }
    catch (e) { handleApiError(e, setError); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Connect WhatsApp" description="We check these details with WhatsApp before saving anything. Tokens are encrypted and never shown again." className="max-w-lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <Field label="Display name" htmlFor="wa-name" error={errors.name?.message}><Input id="wa-name" {...register('name')} /></Field>
          <Field label="Phone number ID" htmlFor="wa-pid" error={errors.phoneNumberId?.message} hint="Meta for Developers → your app → WhatsApp → API setup."><Input id="wa-pid" inputMode="numeric" autoComplete="off" {...register('phoneNumberId')} /></Field>
          <Field label="WhatsApp Business Account ID" htmlFor="wa-waba" error={errors.wabaId?.message}><Input id="wa-waba" inputMode="numeric" autoComplete="off" {...register('wabaId')} /></Field>
          <Field label="Permanent access token" htmlFor="wa-token" error={errors.accessToken?.message} hint="Create a System User token with the whatsapp_business_messaging permission."><Input id="wa-token" type="password" autoComplete="off" {...register('accessToken')} /></Field>
          <Field label="App secret" htmlFor="wa-secret" error={errors.appSecret?.message} hint="Meta app → Settings → Basic. Used to verify that webhooks really come from Meta."><Input id="wa-secret" type="password" autoComplete="off" {...register('appSecret')} /></Field>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" loading={isSubmitting}>Verify and connect</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Templates() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['whatsapp', 'templates'], queryFn: () => api<WaTemplate[]>('/whatsapp/templates') });
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<TemplateForm, unknown, z.infer<typeof templateSchema>>({ resolver: zodResolver(templateSchema), defaultValues: { language: 'en', category: 'UTILITY' } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/whatsapp/templates/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'templates'] }), onError: (e) => handleApiError(e) });
  return (
    <div className="space-y-3">
      <div><p className="text-label">Message templates</p><p className="text-helper">After 24 hours of silence WhatsApp only allows approved templates. Register the exact names of templates you have already had approved in Meta.</p></div>
      {list.data?.length ? <ul className="divide-y divide-border rounded-lg border border-border">{list.data.map((t) => <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-[13px]"><div className="min-w-0 flex-1"><p className="font-medium">{t.name} <span className="text-helper">({t.language})</span></p><p className="text-helper truncate">{t.bodyPreview}</p></div><Button variant="ghost" size="icon" aria-label={`Remove ${t.name}`} onClick={() => remove.mutate(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button></li>)}</ul> : <p className="text-helper">No templates registered.</p>}
      <form className="grid gap-2 sm:grid-cols-[1fr_5rem_1.5fr_auto] sm:items-start" noValidate onSubmit={handleSubmit(async (v) => { try { await api('/whatsapp/templates', { method: 'POST', body: v }); reset(); await qc.invalidateQueries({ queryKey: ['whatsapp', 'templates'] }); } catch (e) { handleApiError(e, setError); } })}>
        <Field label="Name" htmlFor="tpl-name" error={errors.name?.message}><Input id="tpl-name" placeholder="site_visit_reminder" {...register('name')} /></Field>
        <Field label="Language" htmlFor="tpl-lang" error={errors.language?.message}><Input id="tpl-lang" {...register('language')} /></Field>
        <Field label="Text (use {{1}}, {{2}} for values)" htmlFor="tpl-body" error={errors.bodyPreview?.message}><Input id="tpl-body" placeholder="Hi {{1}}, your visit is on {{2}}" {...register('bodyPreview')} /></Field>
        <Button type="submit" className="sm:mt-[22px]" loading={isSubmitting}><Plus className="h-4 w-4" aria-hidden />Add</Button>
      </form>
    </div>
  );
}

export function WhatsappCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<Channel[]>('/channels') });
  const test = useMutation({ mutationFn: (id: string) => api<{ ok: boolean; error?: string }>(`/channels/${id}/test`, { method: 'POST' }), onSuccess: async (r) => { if (r.ok) toast.success('Connection works'); else toast.error(r.error ?? 'Connection failed'); await qc.invalidateQueries({ queryKey: ['channels'] }); }, onError: (e) => handleApiError(e) });
  const disable = useMutation({ mutationFn: (id: string) => api(`/channels/${id}`, { method: 'DELETE' }), onSuccess: async () => { toast.success('Channel disabled'); await qc.invalidateQueries({ queryKey: ['channels'] }); }, onError: (e) => handleApiError(e) });
  const ch = channels.data?.[0];

  return (
    <Card>
      <CardHeader><div><CardTitle><MessageCircle className="mr-1.5 inline h-4 w-4" aria-hidden />WhatsApp</CardTitle><p className="text-helper mt-0.5">Official WhatsApp Business Cloud API. Customers message your number; replies are sent from the inbox.</p></div>{!ch ? <Button variant="primary" onClick={() => setOpen(true)}>Connect WhatsApp</Button> : null}</CardHeader>
      <CardBody className="space-y-5">
        {channels.isPending ? <Skeleton className="h-16" /> : !ch ? (
          <div className="space-y-2 text-[13px] text-muted-foreground"><p>You will need a Meta developer app with the WhatsApp product, a phone number, and a permanent access token.</p><p>Each customer needs to have contacted you, or opted in, before you can message them. WhatsApp only allows free-form replies for 24 hours after their last message.</p></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-[12rem] flex-1"><p className="text-[13px] font-medium">{ch.name}</p><p className="text-helper num">{ch.displayPhone ?? ch.phoneNumberId} · verified {timeAgo(ch.lastVerifiedAt)}</p></div>
              <Badge tone={ch.status === 'ACTIVE' ? 'success' : ch.status === 'ERROR' ? 'danger' : 'neutral'}>{ch.status === 'ACTIVE' ? 'Connected' : ch.status === 'ERROR' ? 'Connection problem' : 'Disabled'}</Badge>
              <Button size="sm" loading={test.isPending} onClick={() => test.mutate(ch.id)}>{ch.status === 'DISABLED' ? 'Reconnect' : 'Test connection'}</Button>
              {ch.status !== 'DISABLED' ? <Button size="sm" variant="ghost" onClick={() => disable.mutate(ch.id)}>Disable</Button> : null}
            </div>
            {ch.status === 'ERROR' ? <p className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-[13px] text-danger"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />WhatsApp rejected the last check. The access token may have expired or been revoked. Reconnect with a new token.</p> : null}

            <div className="space-y-3 rounded-lg bg-muted/60 p-4">
              <p className="text-[13px] font-medium">Finish setup in Meta</p>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground"><li>In your Meta app open <strong>WhatsApp → Configuration</strong>.</li><li>Under Webhook, paste the callback URL and verify token below, then click <strong>Verify and save</strong>.</li><li>Subscribe to the <strong>messages</strong> field.</li><li>Send a message to your number from a phone: it should appear in the Inbox within seconds.</li></ol>
              <CopyField label="Callback URL" value={ch.webhookUrl} /><CopyField label="Verify token" value={ch.verifyToken} />
              <p className="text-helper">Meta can only reach a public HTTPS address. For local testing use a tunnel to your API.</p>
            </div>
            <Templates />
          </>
        )}
      </CardBody>
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
