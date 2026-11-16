'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { inviteSchema, type InviteInput } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Send, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

interface Member { id: string; status: 'ACTIVE' | 'INVITED' | 'DEACTIVATED'; roleKey: string; roleName: string; joinedAt: string; user: { id: string; name: string; email: string } }
interface Invitation { id: string; email: string; expiresAt: string; role: { key: string; name: string } }

const ROLES = [{ key: 'owner', name: 'Business Owner' }, { key: 'manager', name: 'Sales Manager' }, { key: 'agent', name: 'Sales Agent' }] as const;

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { ctx } = useAuth();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { roleKey: 'agent' } });
  const grantable = ROLES.filter((r) => r.key !== 'owner' || ctx.permissions.includes('billing:manage'));
  async function onSubmit(v: InviteInput) {
    try {
      await api('/team/invitations', { method: 'POST', body: v });
      toast.success(`Invitation sent to ${v.email}`);
      await qc.invalidateQueries({ queryKey: ['team'] });
      reset(); onOpenChange(false);
    } catch (e) { handleApiError(e, setError); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Invite a teammate" description="They will get an email with a link that expires in 7 days.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="invite-email" error={errors.email?.message}><Input id="invite-email" type="email" autoFocus {...register('email')} /></Field>
          <Field label="Role" htmlFor="invite-role" error={errors.roleKey?.message}>
            <select id="invite-role" className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px]" {...register('roleKey')}>
              {grantable.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" loading={isSubmitting}><Send className="h-3.5 w-3.5" aria-hidden />Send invitation</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const { can, ctx } = useAuth();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = can('team:invite');
  const canManage = can('team:manage');
  const members = useQuery({ queryKey: ['team', 'members'], queryFn: () => api<Member[]>('/team/members') });
  const invitations = useQuery({ queryKey: ['team', 'invitations'], queryFn: () => api<Invitation[]>('/team/invitations'), enabled: canInvite });

  const act = useMutation({
    mutationFn: (a: { path: string; method: string; body?: unknown; ok: string }) => api(a.path, { method: a.method, body: a.body }).then(() => a.ok),
    onSuccess: (msg) => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['team'] }); },
    onError: (e) => handleApiError(e),
  });

  return (
    <>
      <PageHeader title="Team" description="People who can access this workspace." actions={canInvite ? <Button variant="primary" onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" aria-hidden />Invite teammate</Button> : undefined} />
      <Card>
        <CardHeader><CardTitle>Members {members.data ? <span className="num ml-1 font-normal text-muted-foreground">{members.data.length}</span> : null}</CardTitle></CardHeader>
        {members.isPending ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : members.isError ? (
          <EmptyState icon={UserPlus} title="Could not load members" description="Please reload the page." />
        ) : (
          <ul className="divide-y divide-border">
            {members.data.map((m) => {
              const self = m.user.id === ctx.user.id;
              return (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={m.user.name} size={32} />
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{m.user.name}{self ? <span className="text-helper ml-1.5">(you)</span> : null}</p><p className="text-helper truncate">{m.user.email}</p></div>
                  <Badge tone={m.roleKey === 'owner' ? 'primary' : 'neutral'}>{m.roleName}</Badge>
                  {m.status === 'DEACTIVATED' ? <Badge tone="warning">Deactivated</Badge> : null}
                  {canManage && !self ? (
                    <Dropdown trigger={<Button variant="ghost" size="icon" aria-label={`Actions for ${m.user.name}`}><MoreHorizontal className="h-4 w-4" /></Button>}>
                      {ROLES.filter((r) => r.key !== m.roleKey).map((r) => (
                        <DropdownItem key={r.key} onSelect={() => act.mutate({ path: `/team/members/${m.id}/role`, method: 'PATCH', body: { roleKey: r.key }, ok: `${m.user.name} is now ${r.name}` })}>Make {r.name}</DropdownItem>
                      ))}
                      <DropdownSeparator />
                      {m.status === 'ACTIVE'
                        ? <DropdownItem danger onSelect={() => act.mutate({ path: `/team/members/${m.id}/status`, method: 'PATCH', body: { status: 'DEACTIVATED' }, ok: `${m.user.name} was deactivated` })}>Deactivate</DropdownItem>
                        : <DropdownItem onSelect={() => act.mutate({ path: `/team/members/${m.id}/status`, method: 'PATCH', body: { status: 'ACTIVE' }, ok: `${m.user.name} was re-activated` })}>Re-activate</DropdownItem>}
                    </Dropdown>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canInvite && invitations.data && invitations.data.length > 0 ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
          <ul className="divide-y divide-border">
            {invitations.data.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{i.email}</p><p className="text-helper">Expires {new Date(i.expiresAt).toLocaleDateString()}</p></div>
                <Badge>{i.role.name}</Badge>
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/team/invitations/${i.id}`, method: 'DELETE', ok: 'Invitation revoked' })}>Revoke</Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
