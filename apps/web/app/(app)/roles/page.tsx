'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface Role { id: string; key: string; name: string; isSystem: boolean; permissions: { key: string; description: string }[] }

export default function RolesPage() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  return (
    <>
      <PageHeader title="Roles & permissions" description="What each role can do. System roles are fixed; custom roles and per-person overrides come later." />
      {roles.isPending ? <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div> : roles.isError ? <p className="text-[13px] text-danger">Could not load roles.</p> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {roles.data.map((r) => {
            const groups = new Map<string, Role['permissions']>();
            r.permissions.forEach((p) => { const g = p.key.split(':')[0] ?? 'other'; groups.set(g, [...(groups.get(g) ?? []), p]); });
            return (
              <Card key={r.id}>
                <CardHeader><CardTitle>{r.name}</CardTitle>{r.isSystem ? <Badge>System</Badge> : null}</CardHeader>
                <CardBody className="max-h-[28rem] space-y-4 overflow-y-auto" tabIndex={0} role="region" aria-label="Permissions">
                  <p className="text-helper num">{r.permissions.length} permissions</p>
                  {[...groups.entries()].map(([g, perms]) => (
                    <div key={g}>
                      <p className="text-label mb-1.5 capitalize text-muted-foreground">{g}</p>
                      <ul className="space-y-1">{perms.map((p) => <li key={p.key} className="flex items-start gap-2 text-[13px]"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />{p.description}</li>)}</ul>
                    </div>
                  ))}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
