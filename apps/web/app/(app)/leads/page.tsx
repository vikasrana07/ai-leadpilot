'use client';

import type { LeadDto, PagedResult } from '@leadpilot/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Flame, FolderKanban, Plus, Tag, Upload, User, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ImportDialog } from '@/components/crm/import-dialog';
import { LeadFormDialog } from '@/components/crm/lead-form-dialog';
import { StageBadge, TemperatureBadge } from '@/components/crm/lead-badges';
import { DataTableToolbar, useTablePreferences, type ColumnDef, type FilterDimension } from '@/components/data-table';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { API_URL, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { qs, useLeadMeta, useMembers, useStages } from '@/lib/crm';
import { formatBudget, timeAgo } from '@/lib/format';
import { usePack, useTerms } from '@/lib/pack';
import { t } from '@/lib/i18n';

type SortKey = 'createdAt' | 'name' | 'score' | 'nextFollowUpAt';
type BulkBody = { action: 'assign'; assignedMembershipId: string | null } | { action: 'stage'; stageId: string; lostReasonId?: string } | { action: 'tag'; add: string[]; remove: string[] } | { action: 'delete' };

export default function LeadsPage() {
  const { can } = useAuth();
  const lf = usePack().leadFields;
  const terms = useTerms();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const [f, setF] = useState<{
    stageId: string[];
    temperature: string[];
    assigned: string[];
    sourceId: string[];
    kind: string;
    overdue: string;
  }>({
    stageId: [],
    temperature: [],
    assigned: [],
    sourceId: [],
    kind: '',
    overdue: '',
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const stages = useStages();
  const meta = useLeadMeta();
  const members = useMembers();

  // Column definitions for Leads table
  const columns: ColumnDef[] = useMemo(
    () => [
      { id: 'lead', label: terms.Lead, alwaysVisible: true },
      { id: 'stage', label: 'Stage' },
      { id: 'temperature', label: 'Temp.' },
      ...(lf.budget ? [{ id: 'budget', label: lf.budget.label }] : []),
      { id: 'assigned', label: 'Assigned' },
      { id: 'score', label: 'Score' },
      { id: 'followUp', label: 'Follow-up' },
      { id: 'createdAt', label: 'Added' },
    ],
    [terms.Lead, lf.budget]
  );

  const {
    isColumnVisible,
    toggleColumn,
    resetColumns,
    showAllColumns,
    density,
    setDensity,
    densityCellClass,
    densityHeaderClass,
  } = useTablePreferences('leads', columns);

  const params = {
    q,
    stageId: f.stageId.join(',') || undefined,
    temperature: f.temperature.join(',') || undefined,
    assigned: f.assigned.join(',') || undefined,
    sourceId: f.sourceId.join(',') || undefined,
    kind: f.kind || undefined,
    overdue: f.overdue || undefined,
    sort: sort.key,
    dir: sort.dir,
  };
  const leads = useQuery({ queryKey: ['leads', 'list', params, page], queryFn: () => api<PagedResult<LeadDto>>(`/leads${qs({ ...params, page, pageSize: 25 })}`), placeholderData: (prev) => prev });
  const canWriteAll = can('lead:write:all');
  const items = leads.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const filtered =
    f.stageId.length > 0 ||
    f.temperature.length > 0 ||
    f.assigned.length > 0 ||
    f.sourceId.length > 0 ||
    Boolean(f.overdue) ||
    Boolean(f.kind) ||
    q !== '';

  const bulk = useMutation({
    mutationFn: (b: BulkBody) => api<{ updated: number; skipped: { id: string; reason: string }[] }>('/leads/bulk', { method: 'POST', body: { ...b, ids: [...selected] } }),
    onSuccess: (r) => {
      toast[r.skipped.length ? 'warning' : 'success'](`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped: ${r.skipped[0]?.reason}` : ''}`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['leads'] }); void qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Bulk action failed'),
  });

  async function exportCsv() {
    const res = await fetch(`${API_URL}/leads/export${qs({ ...params })}`, { credentials: 'include' });
    if (!res.ok) { toast.error('Export failed'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // Filter dimensions definition (multi-select by default)
  const dimensions: FilterDimension[] = useMemo(
    () => [
      {
        id: 'stageId',
        label: 'Stage',
        icon: FolderKanban,
        mode: 'multi',
        options:
          stages.data?.stages.map((s) => ({
            value: s.id,
            label: s.name,
            dotColor: s.kind === 'WON' ? '#146c36' : s.kind === 'LOST' ? '#c62828' : '#3f55e8',
          })) ?? [],
      },
      {
        id: 'temperature',
        label: 'Temperature',
        icon: Flame,
        mode: 'multi',
        options: [
          { value: 'HOT', label: 'Hot', dotColor: '#ef4444' },
          { value: 'WARM', label: 'Warm', dotColor: '#f59e0b' },
          { value: 'COLD', label: 'Cold', dotColor: '#3b82f6' },
          { value: 'UNKNOWN', label: 'Unscored', dotColor: '#9ca3af' },
        ],
      },
      ...(canWriteAll
        ? [
            {
              id: 'assigned',
              label: 'Assigned to',
              icon: User,
              mode: 'multi' as const,
              options: [
                { value: 'me', label: 'Assigned to me' },
                { value: 'unassigned', label: 'Unassigned' },
                ...(members.data?.map((m) => ({ value: m.id, label: m.user.name })) ?? []),
              ],
            },
          ]
        : []),
      {
        id: 'sourceId',
        label: 'Source',
        icon: Tag,
        mode: 'multi',
        options: meta.data?.sources.map((s) => ({ value: s.id, label: s.name })) ?? [],
      },
    ],
    [stages.data?.stages, canWriteAll, members.data, meta.data?.sources]
  );

  const activeFilters = useMemo(
    () => ({
      stageId: f.stageId,
      temperature: f.temperature,
      assigned: f.assigned,
      sourceId: f.sourceId,
    }),
    [f.stageId, f.temperature, f.assigned, f.sourceId]
  );

  const handleFilterChange = (dimId: string, values: string[]) => {
    setF((s) => ({ ...s, [dimId]: values }));
    setPage(1);
  };

  const handleClearAllFilters = () => {
    setSearch('');
    setF({ stageId: [], temperature: [], assigned: [], sourceId: [], kind: '', overdue: '' });
    setPage(1);
  };

  const th = (label: string, key?: SortKey, cls = '') => (
    <th
      scope="col"
      className={cn('font-medium', densityHeaderClass, cls)}
      aria-sort={key && sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {key ? (
        <button
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
        >
          {label}
          {sort.key === key ? (
            sort.dir === 'asc' ? (
              <ArrowUp className="h-3 w-3" aria-hidden />
            ) : (
              <ArrowDown className="h-3 w-3" aria-hidden />
            )
          ) : null}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <>
      <PageHeader
        title={terms.Leads}
        description="Every enquiry, scored and assigned."
        actions={
          <>
            {can('lead:import') ? (
              <Button onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                {t('leads.import')}
              </Button>
            ) : null}
            {can('lead:export') ? (
              <Button onClick={() => void exportCsv()}>
                <Download className="h-4 w-4" aria-hidden />
                {t('leads.export')}
              </Button>
            ) : null}
            {can('lead:write:all') || can('lead:write:own') ? (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />Add {terms.lead}
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="overflow-hidden">
        {/* Dynamic Data Table Toolbar */}
        <DataTableToolbar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder={`Search ${terms.leads} by name, phone, email…`}
          dimensions={dimensions}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearAllFilters={handleClearAllFilters}
          booleanFilters={[
            {
              id: 'overdue',
              label: 'Follow-up overdue',
              checked: f.overdue === 'true',
              onChange: (checked) => {
                setF((s) => ({ ...s, overdue: checked ? 'true' : '' }));
                setPage(1);
              },
            },
          ]}
          columns={columns}
          isColumnVisible={isColumnVisible}
          onToggleColumn={toggleColumn}
          onResetColumns={resetColumns}
          onShowAllColumns={showAllColumns}
          density={density}
          onDensityChange={setDensity}
        />

        {/* Bulk Selection Actions Bar */}
        {selected.size > 0 ? (
          <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-3 py-2 text-[13px]">
            <span className="num font-medium">{selected.size} selected</span>
            {can('lead:assign') ? (
              <Select
                aria-label="Assign selected to"
                className="w-auto"
                value=""
                onChange={(e) => {
                  if (e.target.value) bulk.mutate({ action: 'assign', assignedMembershipId: e.target.value === 'none' ? null : e.target.value });
                }}
              >
                <option value="">Assign to…</option>
                <option value="none">Unassigned</option>
                {members.data?.filter((m) => m.status === 'ACTIVE').map((m) => (
                  <option key={m.id} value={m.id}>{m.user.name}</option>
                ))}
              </Select>
            ) : null}
            <Select
              aria-label="Move selected to stage"
              className="w-auto"
              value=""
              onChange={(e) => {
                const s = stages.data?.stages.find((x) => x.id === e.target.value);
                if (s && s.kind !== 'LOST') bulk.mutate({ action: 'stage', stageId: s.id });
                else if (s) toast.info('Open each lead to record why it was lost');
              }}
            >
              <option value="">Move to stage…</option>
              {stages.data?.stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            {can('lead:delete') ? (
              <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        ) : null}

        {/* Table Content */}
        {leads.isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : leads.isError ? (
          <EmptyState
            icon={Users}
            title={`Could not load ${terms.leads}`}
            description="Check your connection and try again."
            action={<Button onClick={() => void leads.refetch()}>Retry</Button>}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={filtered ? `No ${terms.leads} match these filters` : `No ${terms.leads} yet`}
            description={
              filtered
                ? 'Try clearing a filter or searching for something else.'
                : `Add your first ${terms.lead}, import a CSV, or connect a lead source.`
            }
            action={
              !filtered && (can('lead:write:all') || can('lead:write:own')) ? (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden />Add {terms.lead}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={cn(leads.isPlaceholderData && 'opacity-60 transition-opacity')}>
            {/* Mobile View */}
            <ul className="divide-y divide-border md:hidden" aria-label={terms.Leads}>
              {items.map((l) => (
                <li key={l.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Select ${l.name}`}
                      checked={selected.has(l.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(l.id);
                          else n.delete(l.id);
                          return n;
                        })
                      }
                    />
                    <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-medium">{l.name}</span>
                        <TemperatureBadge value={l.temperature} />
                      </span>
                      <span className="text-helper block truncate">
                        {l.phone ?? l.email}
                        {l.location ? ` · ${l.location}` : ''}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <StageBadge name={l.stage.name} kind={l.stage.kind} />
                        {lf.budget ? (
                          <span className="num text-[12px] text-muted-foreground">
                            {formatBudget(l.budgetMin, l.budgetMax)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-helper mt-1.5 block">
                        {l.assignee ? l.assignee.name : 'Unassigned'} · added {timeAgo(l.createdAt)}
                        {l.nextFollowUpAt && l.stage.kind === 'OPEN'
                          ? ` · follow-up ${timeAgo(l.nextFollowUpAt)}`
                          : ''}
                      </span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop Table View */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-left">
                <thead className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-xs text-label text-muted-foreground shadow-xs">
                  <tr>
                    <th scope="col" className={cn('w-10 px-3', densityHeaderClass)}>
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allOnPage}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            items.forEach((l) => (e.target.checked ? n.add(l.id) : n.delete(l.id)));
                            return n;
                          })
                        }
                      />
                    </th>
                    {isColumnVisible('lead') && th(terms.Lead, 'name')}
                    {isColumnVisible('stage') && th('Stage')}
                    {isColumnVisible('temperature') && th('Temp.')}
                    {lf.budget && isColumnVisible('budget') ? th(lf.budget.label) : null}
                    {isColumnVisible('assigned') && th('Assigned')}
                    {isColumnVisible('score') && th('Score', 'score', 'text-right')}
                    {isColumnVisible('followUp') && th('Follow-up', 'nextFollowUpAt')}
                    {isColumnVisible('createdAt') && th('Added', 'createdAt')}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((l) => {
                    const overdue =
                      l.nextFollowUpAt !== null &&
                      new Date(l.nextFollowUpAt) < new Date() &&
                      l.stage.kind === 'OPEN';

                    return (
                      <tr
                        key={l.id}
                        className={cn('hover:bg-muted/40 transition-colors', selected.has(l.id) && 'bg-primary-soft/50')}
                      >
                        <td className={cn('w-10 px-3', densityCellClass)}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${l.name}`}
                            checked={selected.has(l.id)}
                            onChange={(e) =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(l.id);
                                else n.delete(l.id);
                                return n;
                              })
                            }
                          />
                        </td>

                        {isColumnVisible('lead') && (
                          <td className={densityCellClass}>
                            <Link href={`/leads/${l.id}`} className="block">
                              <span className="font-medium hover:text-primary">{l.name}</span>
                              <span className="text-helper block">
                                {l.phone ?? l.email}
                                {l.location ? ` · ${l.location}` : ''}
                              </span>
                            </Link>
                          </td>
                        )}

                        {isColumnVisible('stage') && (
                          <td className={densityCellClass}>
                            <StageBadge name={l.stage.name} kind={l.stage.kind} />
                          </td>
                        )}

                        {isColumnVisible('temperature') && (
                          <td className={densityCellClass}>
                            <TemperatureBadge value={l.temperature} />
                          </td>
                        )}

                        {lf.budget && isColumnVisible('budget') ? (
                          <td className={cn('num whitespace-nowrap', densityCellClass)}>
                            {formatBudget(l.budgetMin, l.budgetMax)}
                          </td>
                        ) : null}

                        {isColumnVisible('assigned') && (
                          <td className={densityCellClass}>
                            {l.assignee ? (
                              <span className="flex items-center gap-2">
                                <Avatar name={l.assignee.name} size={density === 'compact' ? 18 : 22} />
                                <span className="truncate">{l.assignee.name}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Unassigned</span>
                            )}
                          </td>
                        )}

                        {isColumnVisible('score') && (
                          <td className={cn('num text-right', densityCellClass)}>
                            {l.score ?? <span className="text-muted-foreground">—</span>}
                          </td>
                        )}

                        {isColumnVisible('followUp') && (
                          <td className={cn('num whitespace-nowrap', densityCellClass, overdue && 'font-medium text-danger')}>
                            {l.nextFollowUpAt ? timeAgo(l.nextFollowUpAt) : <span className="text-muted-foreground">—</span>}
                          </td>
                        )}

                        {isColumnVisible('createdAt') && (
                          <td className={cn('num whitespace-nowrap text-muted-foreground', densityCellClass)}>
                            {timeAgo(l.createdAt)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {leads.data && leads.data.total > 0 ? (
          <Pagination page={page} pageSize={25} total={leads.data.total} onPage={setPage} />
        ) : null}
      </Card>

      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        endpoint="/leads/import"
        title={`Import ${terms.leads}`}
        hint={
          lf.budget
            ? 'CSV with a header row. Columns: name, phone, email, budget, location, source, tags… Amounts like 85 L or 1.2 Cr work.'
            : 'CSV with a header row. Columns: name, phone, email, location, source, tags…'
        }
        invalidate={[['leads'], ['pipeline'], ['analytics']]}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        danger
        title={`Delete ${selected.size} ${selected.size === 1 ? terms.lead : terms.leads}?`}
        description="They disappear from lists and reports. This is recorded in the audit log."
        confirmLabel="Delete"
        onConfirm={async () => {
          await bulk.mutateAsync({ action: 'delete' });
        }}
      />
    </>
  );
}
