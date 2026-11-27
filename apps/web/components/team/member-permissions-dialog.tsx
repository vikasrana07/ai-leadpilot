'use client';

import { PERMISSIONS } from '@leadpilot/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { handleApiError } from '@/lib/forms';

interface MemberPermissionsView {
  membershipId: string;
  roleKey: string;
  roleName: string;
  rolePermissions: string[];
  overrides: { permissionKey: string; effect: 'GRANT' | 'REVOKE' }[];
  effectivePermissions: string[];
}

export function MemberPermissionsDialog({
  member,
  onClose,
}: {
  member: { id: string; user: { name: string }; roleName: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['team', 'member-permissions', member?.id],
    enabled: !!member,
    queryFn: () => api<MemberPermissionsView>(`/team/members/${member?.id}/permissions`),
  });

  const [overrideMap, setOverrideMap] = useState<Map<string, 'GRANT' | 'REVOKE'>>(new Map());

  useEffect(() => {
    if (!q.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs dialog state with loaded overrides
    setOverrideMap(new Map(q.data.overrides.map((o) => [o.permissionKey, o.effect])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/team/members/${member?.id}/permissions`, {
        method: 'PUT',
        body: {
          overrides: [...overrideMap.entries()].map(([permissionKey, effect]) => ({ permissionKey, effect })),
        },
      }),
    onSuccess: async () => {
      toast.success('Member permissions updated');
      await qc.invalidateQueries({ queryKey: ['team'] });
      onClose();
    },
    onError: (e) => handleApiError(e),
  });

  const roleSet = new Set(q.data?.rolePermissions ?? []);
  const allEntries = Object.entries(PERMISSIONS);

  function cycle(key: string) {
    const inRole = roleSet.has(key);
    const cur = overrideMap.get(key);
    const next = new Map(overrideMap);
    if (inRole) {
      if (cur === 'REVOKE') next.delete(key);
      else next.set(key, 'REVOKE');
    } else {
      if (cur === 'GRANT') next.delete(key);
      else next.set(key, 'GRANT');
    }
    setOverrideMap(next);
  }

  return (
    <Dialog open={member !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={member ? `Permissions · ${member.user.name}` : 'Member permissions'}
        description={member ? `Base role: ${member.roleName}. Grant or revoke individual permissions for this member.` : ''}
        size="lg"
      >
        {q.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : q.isError ? (
          <p className="text-[13px] text-danger">Could not load member permissions.</p>
        ) : (
          <div className="space-y-4">
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {allEntries.map(([key, label]) => {
                const inRole = roleSet.has(key);
                const ov = overrideMap.get(key);
                const effective = ov === 'GRANT' ? true : ov === 'REVOKE' ? false : inRole;
                return (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{label}</p>
                      <p className="text-helper font-mono text-[11px]">{key}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {ov === 'GRANT' ? (
                        <Badge tone="success">Granted</Badge>
                      ) : ov === 'REVOKE' ? (
                        <Badge tone="danger">Revoked</Badge>
                      ) : inRole ? (
                        <Badge tone="neutral">From role</Badge>
                      ) : (
                        <Badge tone="neutral">Off</Badge>
                      )}
                      {q.data.roleKey !== 'owner' ? (
                        <Button size="sm" variant="secondary" onClick={() => cycle(key)}>
                          {ov ? 'Reset' : effective ? 'Revoke' : 'Grant'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" onClick={onClose}>Cancel</Button>
              {q.data.roleKey !== 'owner' ? (
                <Button type="button" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                  Save overrides
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
