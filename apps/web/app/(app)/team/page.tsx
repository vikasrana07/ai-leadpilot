'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { inviteSchema, type InviteInput } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Send, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

interface Workload { members: { membershipId: string; name: string; email: string; role: string; openLeads: number; overdueFollowUps: number }[]; unassignedOpenLeads: number }
interface Member { id: string; status: 'ACTIVE' | 'INVITED' | 'DEACTIVATED'; roleKey: string; roleName: string; mfaEnabled?: boolean; joinedAt: string; user: { id: string; name: string; email: string } }
interface Invitation { id: string; email: string; expiresAt: string; role: { key: string; name: string } }

const FALLBACK_ROLES = [{ key: 'owner', name: 'Business Owner' }, { key: 'manager', name: 'Sales Manager' }, { key: 'agent', name: 'Sales Agent' }] as const;

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { ctx } = useAuth();
  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<{ id: string; key: string; name: string }[]>('/roles'),
    enabled: open,
  });
  const allRoles = rolesQuery.data ?? FALLBACK_ROLES;
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { roleKey: 'agent' } });
  const grantable = allRoles.filter((r) => r.key !== 'owner' || ctx.permissions.includes('billing:manage'));
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
      <DialogContent title="Invite a teammate" description="They will get an email with a link that expires in 7 days." size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormErrorAlert errors={errors} />
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

const resetMfaSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(200),
});

type ResetMfaFormValues = z.infer<typeof resetMfaSchema>;

function ResetMfaDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetMfaFormValues>({
    resolver: zodResolver(resetMfaSchema),
    defaultValues: { reason: '' },
  });

  async function onSubmit(data: ResetMfaFormValues) {
    if (!member) return;
    try {
      await api(`/team/members/${member.id}/mfa-reset`, { method: 'POST', body: { reason: data.reason } });
      toast.success(`Two-step verification reset for ${member.user.name}`);
      await qc.invalidateQueries({ queryKey: ['team'] });
      reset();
      onClose();
    } catch (err) {
      handleApiError(err, setError);
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent
        title={`Reset two-step verification for ${member?.user.name ?? ''}`}
        description="Use this only when they have lost their phone and their recovery codes. They are signed out, emailed, and must set it up again. Check who is asking before you continue."
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col justify-between" noValidate>
          <div className="space-y-4">
            <FormErrorAlert errors={errors} />
            <Field label="Reason (kept in the audit log)" htmlFor="mfa-reset-reason" error={errors.reason?.message}>
              <Input
                id="mfa-reset-reason"
                autoFocus
                maxLength={200}
                placeholder="e.g. Lost phone, confirmed by phone call"
                {...register('reason')}
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Reset two-step verification
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const { can, ctx } = useAuth();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetMfa, setResetMfa] = useState<Member | null>(null);
  const canInvite = can('team:invite');
  const canManage = can('team:manage');
  const members = useQuery({ queryKey: ['team', 'members'], queryFn: () => api<Member[]>('/team/members') });
  const workload = useQuery({ queryKey: ['team', 'workload'], queryFn: () => api<Workload>('/team/workload'), enabled: can('analytics:read:team') });
  const invitations = useQuery({ queryKey: ['team', 'invitations'], queryFn: () => api<Invitation[]>('/team/invitations'), enabled: canInvite });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: () => api<{ id: string; key: string; name: string }[]>('/roles'), enabled: canManage });
  const allRoles = rolesQuery.data ?? FALLBACK_ROLES;

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
                  {m.mfaEnabled ? <span className="text-helper inline-flex items-center gap-1" title="Two-step verification is on"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">Two-step verification is on</span></span> : null}
                  {canManage && !self ? (
                    <Dropdown trigger={<Button variant="ghost" size="icon" aria-label={`Actions for ${m.user.name}`}><MoreHorizontal className="h-4 w-4" /></Button>}>
                      {allRoles.filter((r) => r.key !== m.roleKey).map((r) => (
                        <DropdownItem key={r.key} onSelect={() => act.mutate({ path: `/team/members/${m.id}/role`, method: 'PATCH', body: { roleKey: r.key }, ok: `${m.user.name} is now ${r.name}` })}>Make {r.name}</DropdownItem>
                      ))}
                      <DropdownSeparator />
                      {m.mfaEnabled ? <DropdownItem onSelect={() => setResetMfa(m)}>Reset two-step verification</DropdownItem> : null}
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

      {workload.data ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>Workload</CardTitle><span className="text-helper num">{workload.data.unassignedOpenLeads} unassigned open leads</span></CardHeader>
          <div className="overflow-x-auto"><table className="w-full text-left text-[13px]"><thead className="bg-muted/50 text-label text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Member</th><th className="px-4 py-2 text-right font-medium">Open leads</th><th className="px-4 py-2 text-right font-medium">Overdue follow-ups</th></tr></thead>
            <tbody className="divide-y divide-border">{workload.data.members.map((m) => <tr key={m.membershipId}><td className="px-4 py-2"><span className="flex items-center gap-2.5"><Avatar name={m.name} size={24} /><span>{m.name}<span className="text-helper ml-1.5">{m.role}</span></span></span></td><td className="num px-4 py-2 text-right">{m.openLeads}</td><td className={`num px-4 py-2 text-right ${m.overdueFollowUps ? 'font-medium text-danger' : ''}`}>{m.overdueFollowUps}</td></tr>)}</tbody></table></div>
        </Card>
      ) : null}

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
      <ResetMfaDialog member={resetMfa} onClose={() => setResetMfa(null)} />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
