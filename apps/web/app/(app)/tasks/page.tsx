'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  ListChecks,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { TaskDrawer } from '@/components/crm/task-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TasksListRowsSkeleton } from '@/components/skeletons';
import { useTasksControllerList, useTasksControllerRemove, tasksControllerUpdate } from '@/lib/api-generated/tasks/tasks';
import { useAuth } from '@/lib/auth';
import { useMembers } from '@/lib/crm';
import { handleApiError } from '@/lib/forms';
import { cn } from '@/lib/cn';
import type { TaskItem } from '@/lib/ops';

type FilterTab = 'OPEN' | 'TODAY' | 'OVERDUE' | 'DONE' | 'ALL';
type SortOption = 'due-asc' | 'due-desc' | 'created-desc' | 'title-asc';

function isDueToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isDueTomorrow(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  return d.getFullYear() === tom.getFullYear() && d.getMonth() === tom.getMonth() && d.getDate() === tom.getDate();
}

function formatTaskDate(dueAt: string | null, overdue: boolean, status: 'OPEN' | 'DONE') {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  if (status === 'DONE') {
    return {
      label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      tone: 'neutral' as const,
    };
  }

  if (isDueToday(dueAt)) {
    return {
      label: `Today, ${timeStr}`,
      tone: overdue ? ('danger' as const) : ('warning' as const),
    };
  }
  if (isDueTomorrow(dueAt)) {
    return {
      label: `Tomorrow, ${timeStr}`,
      tone: 'neutral' as const,
    };
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (overdue) {
    return {
      label: `Overdue · ${dateStr}`,
      tone: 'danger' as const,
    };
  }
  return {
    label: `${dateStr}, ${timeStr}`,
    tone: 'neutral' as const,
  };
}

export default function TasksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const members = useMembers();

  // Filters & State
  const [mine, setMine] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('OPEN');
  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('due-asc');

  // Drawer & Edit State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);

  // Delete State
  const [taskToDelete, setTaskToDelete] = useState<TaskItem | null>(null);

  // Queries
  const list = useTasksControllerList(
    { mine: mine ? 'true' : 'false', limit: 200 },
    { query: { queryKey: ['tasks', mine] } },
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });

  const toggle = useMutation({
    mutationFn: (t: TaskItem) =>
      tasksControllerUpdate(t.id, { status: t.status === 'OPEN' ? 'DONE' : 'OPEN' }),
    onMutate: async (t: TaskItem) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const previous = qc.getQueriesData<{ items: TaskItem[] }>({ queryKey: ['tasks'] });
      const nextStatus: 'OPEN' | 'DONE' = t.status === 'OPEN' ? 'DONE' : 'OPEN';

      qc.setQueriesData<{ items: TaskItem[] }>({ queryKey: ['tasks'] }, (old) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((item) =>
            item.id === t.id
              ? {
                  ...item,
                  status: nextStatus,
                  completedAt: nextStatus === 'DONE' ? new Date().toISOString() : null,
                }
              : item,
          ),
        };
      });

      return { previous };
    },
    onError: (e, _t, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          qc.setQueryData(key, data);
        }
      }
      handleApiError(e);
    },
    onSettled: () => {
      void refresh();
    },
  });

  const remove = useTasksControllerRemove({
    mutation: {
      onMutate: async ({ id }: { id: string }) => {
        await qc.cancelQueries({ queryKey: ['tasks'] });
        const previous = qc.getQueriesData<{ items: TaskItem[] }>({ queryKey: ['tasks'] });

        qc.setQueriesData<{ items: TaskItem[] }>({ queryKey: ['tasks'] }, (old) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== id),
          };
        });

        return { previous };
      },
      onError: (e, _vars, context) => {
        if (context?.previous) {
          for (const [key, data] of context.previous) {
            qc.setQueryData(key, data);
          }
        }
        handleApiError(e);
      },
      onSuccess: () => {
        toast.success('Task deleted');
        setTaskToDelete(null);
      },
      onSettled: () => {
        void refresh();
      },
    },
  });

  // Calculate Metrics from raw items
  const allItems = list.data?.items ?? [];
  const counts = useMemo(() => {
    let openCount = 0;
    let todayCount = 0;
    let overdueCount = 0;
    let doneCount = 0;

    for (const t of allItems) {
      if (t.status === 'OPEN') {
        openCount++;
        if (t.overdue) overdueCount++;
        else if (isDueToday(t.dueAt)) todayCount++;
      } else {
        doneCount++;
      }
    }
    return {
      open: openCount,
      today: todayCount,
      overdue: overdueCount,
      done: doneCount,
      all: allItems.length,
    };
  }, [allItems]);

  // Filtered & Sorted items
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((t) => {
      // Tab filter
      if (activeTab === 'OPEN' && t.status !== 'OPEN') return false;
      if (activeTab === 'DONE' && t.status !== 'DONE') return false;
      if (activeTab === 'OVERDUE' && (!t.overdue || t.status !== 'OPEN')) return false;
      if (activeTab === 'TODAY' && (!isDueToday(t.dueAt) || t.status !== 'OPEN')) return false;

      // Assignee filter (when viewing everyone)
      if (!mine && assigneeFilter && t.assigneeMembershipId !== assigneeFilter) return false;

      // Search query filter
      if (q) {
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesLead = t.leadName?.toLowerCase().includes(q) ?? false;
        const matchesNotes = t.notes?.toLowerCase().includes(q) ?? false;
        const matchesAssignee = t.assigneeName?.toLowerCase().includes(q) ?? false;
        if (!matchesTitle && !matchesLead && !matchesNotes && !matchesAssignee) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'due-asc') {
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      }
      if (sortBy === 'due-desc') {
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime();
      }
      if (sortBy === 'created-desc') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === 'title-asc') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });
  }, [allItems, activeTab, mine, assigneeFilter, search, sortBy]);

  // Grouped items for the standard 'OPEN' view
  const groupedOpenItems = useMemo(() => {
    if (activeTab !== 'OPEN' || search.trim()) return null;

    const overdue: TaskItem[] = [];
    const today: TaskItem[] = [];
    const upcoming: TaskItem[] = [];
    const noDue: TaskItem[] = [];

    for (const t of filteredItems) {
      if (t.overdue) {
        overdue.push(t);
      } else if (isDueToday(t.dueAt)) {
        today.push(t);
      } else if (t.dueAt) {
        upcoming.push(t);
      } else {
        noDue.push(t);
      }
    }

    return { overdue, today, upcoming, noDue };
  }, [activeTab, search, filteredItems]);

  const openNewTaskDrawer = () => {
    setEditingTask(null);
    setDrawerOpen(true);
  };

  const openEditTaskDrawer = (t: TaskItem) => {
    setEditingTask(t);
    setDrawerOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups and action items from you, your team, and automations."
        actions={
          <Button variant="primary" onClick={openNewTaskDrawer}>
            <Plus className="h-4 w-4" aria-hidden />
            New task
          </Button>
        }
      />

      {/* KPI Stat Cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveTab('OPEN')}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
            activeTab === 'OPEN'
              ? 'border-primary bg-primary-soft/40 shadow-xs'
              : 'border-border bg-card hover:border-border-strong hover:bg-muted/40',
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted-foreground">Open Tasks</p>
            <p className="text-[22px] font-semibold tracking-tight text-foreground">{counts.open}</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('TODAY')}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
            activeTab === 'TODAY'
              ? 'border-warning bg-warning-soft/40 shadow-xs'
              : 'border-border bg-card hover:border-border-strong hover:bg-muted/40',
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted-foreground">Due Today</p>
            <p className="text-[22px] font-semibold tracking-tight text-foreground">{counts.today}</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('OVERDUE')}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
            activeTab === 'OVERDUE'
              ? 'border-danger bg-danger-soft/40 shadow-xs'
              : 'border-border bg-card hover:border-border-strong hover:bg-muted/40',
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted-foreground">Overdue</p>
            <p className={cn('text-[22px] font-semibold tracking-tight', counts.overdue > 0 ? 'text-danger' : 'text-foreground')}>
              {counts.overdue}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('DONE')}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
            activeTab === 'DONE'
              ? 'border-success bg-success-soft/40 shadow-xs'
              : 'border-border bg-card hover:border-border-strong hover:bg-muted/40',
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted-foreground">Completed</p>
            <p className="text-[22px] font-semibold tracking-tight text-foreground">{counts.done}</p>
          </div>
        </button>
      </div>

      {/* Main Task List Card */}
      <Card data-tour="tasks-list" className="overflow-hidden">
        {/* Filter and Control Bar */}
        <div data-tour="tasks-filters" className="border-b border-border bg-card p-3 space-y-3">
          {/* Top Row: Tabs + Scope */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
              {[
                { key: 'OPEN' as const, label: 'Open', count: counts.open },
                { key: 'TODAY' as const, label: 'Today', count: counts.today },
                { key: 'OVERDUE' as const, label: 'Overdue', count: counts.overdue },
                { key: 'DONE' as const, label: 'Done', count: counts.done },
                { key: 'ALL' as const, label: 'All', count: counts.all },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                    activeTab === tab.key
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 ? (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[10px] font-semibold leading-none',
                        activeTab === tab.key
                          ? tab.key === 'OVERDUE'
                            ? 'bg-danger text-danger-foreground'
                            : 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* Scope / Assignee toggles */}
            {can('lead:read:all') ? (
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Filter scope"
                  className="w-auto h-8 text-[12px]"
                  value={mine ? 'mine' : 'all'}
                  onChange={(e) => {
                    setMine(e.target.value === 'mine');
                    setAssigneeFilter('');
                  }}
                >
                  <option value="mine">My Tasks</option>
                  <option value="all">Everyone’s Tasks</option>
                </Select>

                {!mine ? (
                  <Select
                    aria-label="Filter by member"
                    className="w-auto h-8 text-[12px]"
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                  >
                    <option value="">All Team Members</option>
                    {(members.data ?? [])
                      .filter((m) => m.status === 'ACTIVE')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.user.name}
                        </option>
                      ))}
                  </Select>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Bottom Row: Search + Sort */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Search tasks"
                placeholder="Search tasks by title, lead, or notes..."
                className="pl-8 pr-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <Select
              aria-label="Sort by"
              className="w-auto"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="due-asc">Due date (Earliest)</option>
              <option value="due-desc">Due date (Latest)</option>
              <option value="created-desc">Recently created</option>
              <option value="title-asc">Title (A-Z)</option>
            </Select>
          </div>
        </div>

        {/* Content Section */}
        {list.isPending ? (
          <TasksListRowsSkeleton count={6} />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={
              search
                ? 'No matching tasks'
                : activeTab === 'OVERDUE'
                  ? 'No overdue tasks'
                  : activeTab === 'TODAY'
                    ? 'No tasks due today'
                    : activeTab === 'DONE'
                      ? 'No completed tasks'
                      : 'Nothing to do'
            }
            description={
              search
                ? `No tasks match "${search}". Try adjusting your keywords.`
                : activeTab === 'OVERDUE'
                  ? 'Great job staying on schedule! No tasks are past due.'
                  : activeTab === 'TODAY'
                    ? 'You have no deadlines scheduled for today.'
                    : activeTab === 'DONE'
                      ? 'Completed follow-ups and action items will show up here.'
                      : 'Create follow-ups and reminders to keep your deals moving forward.'
            }
            action={
              <Button variant="primary" onClick={openNewTaskDrawer}>
                <Plus className="h-4 w-4" aria-hidden />
                Add task
              </Button>
            }
          />
        ) : groupedOpenItems ? (
          /* Grouped Categorized View for Open Tasks */
          <div className="divide-y divide-border">
            {groupedOpenItems.overdue.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 bg-danger-soft/20 px-4 py-2 text-[12px] font-semibold text-danger">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Overdue ({groupedOpenItems.overdue.length})</span>
                </div>
                <ul className="divide-y divide-border">
                  {groupedOpenItems.overdue.map((t) => (
                    <TaskRowItem
                      key={t.id}
                      task={t}
                      mine={mine}
                      onToggle={() => toggle.mutate(t)}
                      onEdit={() => openEditTaskDrawer(t)}
                      onDelete={() => setTaskToDelete(t)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {groupedOpenItems.today.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 bg-warning-soft/20 px-4 py-2 text-[12px] font-semibold text-warning">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Due Today ({groupedOpenItems.today.length})</span>
                </div>
                <ul className="divide-y divide-border">
                  {groupedOpenItems.today.map((t) => (
                    <TaskRowItem
                      key={t.id}
                      task={t}
                      mine={mine}
                      onToggle={() => toggle.mutate(t)}
                      onEdit={() => openEditTaskDrawer(t)}
                      onDelete={() => setTaskToDelete(t)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {groupedOpenItems.upcoming.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 bg-muted/40 px-4 py-2 text-[12px] font-semibold text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Upcoming ({groupedOpenItems.upcoming.length})</span>
                </div>
                <ul className="divide-y divide-border">
                  {groupedOpenItems.upcoming.map((t) => (
                    <TaskRowItem
                      key={t.id}
                      task={t}
                      mine={mine}
                      onToggle={() => toggle.mutate(t)}
                      onEdit={() => openEditTaskDrawer(t)}
                      onDelete={() => setTaskToDelete(t)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {groupedOpenItems.noDue.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 bg-muted/40 px-4 py-2 text-[12px] font-semibold text-muted-foreground">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>No Due Date ({groupedOpenItems.noDue.length})</span>
                </div>
                <ul className="divide-y divide-border">
                  {groupedOpenItems.noDue.map((t) => (
                    <TaskRowItem
                      key={t.id}
                      task={t}
                      mine={mine}
                      onToggle={() => toggle.mutate(t)}
                      onEdit={() => openEditTaskDrawer(t)}
                      onDelete={() => setTaskToDelete(t)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          /* Flat Filtered List */
          <ul className="divide-y divide-border">
            {filteredItems.map((t) => (
              <TaskRowItem
                key={t.id}
                task={t}
                mine={mine}
                onToggle={() => toggle.mutate(t)}
                onEdit={() => openEditTaskDrawer(t)}
                onDelete={() => setTaskToDelete(t)}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Tight Side Drawer for Add / Edit */}
      <TaskDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        taskToEdit={editingTask}
        onSuccess={refresh}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={taskToDelete !== null}
        onOpenChange={(o) => {
          if (!o) setTaskToDelete(null);
        }}
        title="Delete Task"
        description={`Are you sure you want to delete "${taskToDelete?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (taskToDelete) {
            await remove.mutateAsync({ id: taskToDelete.id });
          }
        }}
      />
    </>
  );
}

function TaskRowItem({
  task,
  mine,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: TaskItem;
  mine: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isDone = task.status === 'DONE';
  const dueInfo = formatTaskDate(task.dueAt, task.overdue, task.status);

  return (
    <li
      className={cn(
        'group flex items-start gap-3 px-4 py-3 text-[13px] transition-colors hover:bg-muted/30',
        isDone && 'opacity-70 bg-muted/10',
      )}
    >
      {/* Status Toggle Button */}
      <button
        type="button"
        aria-label={isDone ? `Reopen ${task.title}` : `Mark ${task.title} completed`}
        onClick={onToggle}
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {isDone ? (
          <CheckCircle2 className="h-5 w-5 text-success" />
        ) : (
          <Circle className="h-5 w-5 hover:text-primary" />
        )}
      </button>

      {/* Task Content */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'break-words font-medium text-foreground',
            isDone && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </p>

        {/* Metadata Badges & Links */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-helper">
          {task.leadId ? (
            <Link
              href={`/leads/${task.leadId}`}
              className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 font-medium text-foreground hover:bg-muted hover:text-primary transition-colors"
            >
              <User className="h-3 w-3 text-muted-foreground" aria-hidden />
              <span className="truncate max-w-[160px]">{task.leadName}</span>
            </Link>
          ) : null}

          {!mine && task.assigneeName ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span>Assigned to</span>
              <span className="font-medium text-foreground">{task.assigneeName}</span>
            </span>
          ) : null}

          {task.source === 'automation' ? (
            <Badge tone="primary" className="gap-1 py-0 px-1.5 text-[10px]">
              <Bot className="h-3 w-3" aria-hidden />
              Automation
            </Badge>
          ) : null}

          {task.notes ? (
            <p className="line-clamp-1 text-muted-foreground text-[12px] italic">
              &ldquo;{task.notes}&rdquo;
            </p>
          ) : null}
        </div>
      </div>

      {/* Due Date Indicator */}
      {dueInfo ? (
        <Badge tone={dueInfo.tone} className="shrink-0 self-center">
          {dueInfo.label}
        </Badge>
      ) : null}

      {/* Action Buttons */}
      <div className="flex shrink-0 items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Edit ${task.title}`}
          onClick={onEdit}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${task.title}`}
          onClick={onDelete}
          className="h-8 w-8 text-muted-foreground hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
