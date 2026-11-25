'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  Building2,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { fmtDate } from '@/lib/billing';
import { platformApi, type PlatformPlan, type PlatformTenantRow } from '@/lib/platform';

export default function PlatformTenants() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');

  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => platformApi<PlatformPlan[]>('/plans'),
  });

  const qs = new URLSearchParams({
    limit: '100',
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status } : {}),
    ...(plan ? { plan } : {}),
  }).toString();

  const q = useQuery({
    queryKey: ['platform-tenants', qs],
    queryFn: () => platformApi<PlatformTenantRow[]>(`/tenants?${qs}`),
  });

  const hasFilters = Boolean(search || status || plan);
  const totalCount = q.data?.length ?? 0;
  const activeCount = q.data?.filter((t) => t.status === 'ACTIVE').length ?? 0;
  const suspendedCount = q.data?.filter((t) => t.status === 'SUSPENDED').length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspaces & Tenants"
        description="Comprehensive registry of all customer accounts, subscription entitlements, and operational status."
      />

      {/* Summary KPI Pills */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 shadow-2xs">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-[13px] text-muted-foreground">Showing:</span>
          <span className="num text-[13px] font-semibold text-foreground">
            {totalCount} {totalCount === 1 ? 'Workspace' : 'Workspaces'}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 shadow-2xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[13px] text-muted-foreground">Active:</span>
          <span className="num text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
            {activeCount}
          </span>
        </div>
        {suspendedCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-[13px] text-muted-foreground">Suspended:</span>
            <span className="num text-[13px] font-semibold text-rose-600 dark:text-rose-400">
              {suspendedCount}
            </span>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-8"
              placeholder="Search by workspace name or email..."
              aria-label="Search workspaces"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-36 text-[13px]"
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </Select>

            <Select
              className="w-40 text-[13px]"
              aria-label="Filter by plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              <option value="">All plans</option>
              {plans.data?.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                  setPlan('');
                }}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Data Table */}
      {q.isPending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground">
            Loading workspaces...
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-5 w-20 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="overflow-x-auto shadow-sm">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="px-5 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-4 py-3 text-right font-medium">Seats</th>
                <th className="px-4 py-3 text-right font-medium">Leads</th>
                <th className="px-5 py-3 text-right font-medium">Created</th>
                <th className="px-3 py-3 text-center font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data?.map((t) => (
                <tr
                  key={t.id}
                  className="group transition-colors hover:bg-muted/40"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={t.name} size={32} />
                      <div className="min-w-0">
                        <Link
                          href={`/platform/tenants/${t.id}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
                        >
                          <span className="truncate">{t.name}</span>
                        </Link>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {t.email}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium font-mono text-foreground uppercase">
                      {t.planKey}
                    </span>
                  </td>

                  <td className="px-4 py-3.5">
                    <Badge tone={t.status === 'ACTIVE' ? 'success' : 'danger'}>
                      {t.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                    </Badge>
                  </td>

                  <td className="px-4 py-3.5">
                    <div className="text-[13px] text-foreground">
                      {t.subscriptionStatus ? (
                        <span className="capitalize">{t.subscriptionStatus}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {t.provider === 'manual' && (
                        <span className="ml-1.5 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Complimentary
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="num px-4 py-3.5 text-right font-medium text-foreground">
                    {t.seats}
                  </td>

                  <td className="num px-4 py-3.5 text-right font-medium text-foreground">
                    {t.leads.toLocaleString('en-IN')}
                  </td>

                  <td className="px-5 py-3.5 text-right text-muted-foreground whitespace-nowrap">
                    {fmtDate(t.createdAt)}
                  </td>

                  <td className="px-3 py-3.5 text-center">
                    <Link
                      href={`/platform/tenants/${t.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all"
                      title="View Details"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}

              {q.data?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="mx-auto max-w-sm space-y-2">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <p className="text-[15px] font-semibold text-foreground">
                        No workspaces found
                      </p>
                      <p className="text-helper text-[13px]">
                        {hasFilters
                          ? 'Try adjusting your search query or status filter.'
                          : 'No tenants have registered on the platform yet.'}
                      </p>
                      {hasFilters && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            setSearch('');
                            setStatus('');
                            setPlan('');
                          }}
                        >
                          Clear Filters
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
