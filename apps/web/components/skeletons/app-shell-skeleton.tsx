import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeaderSkeleton, TableSkeleton } from './skeleton-primitives';
import { DashboardSkeleton } from './dashboard-skeleton';
import { LeadsSkeleton } from './leads-skeleton';
import { LeadDetailSkeleton } from './lead-detail-skeleton';
import { PipelineSkeleton } from './pipeline-skeleton';
import { InboxSkeleton } from './inbox-skeleton';
import { AppointmentsSkeleton } from './appointments-skeleton';
import { TasksSkeleton } from './tasks-skeleton';
import { AutomationsSkeleton } from './automations-skeleton';
import { CampaignsSkeleton } from './campaigns-skeleton';
import { PropertiesSkeleton } from './properties-skeleton';
import { TeamSkeleton } from './team-skeleton';
import { RolesSkeleton } from './roles-skeleton';
import { BillingSkeleton } from './billing-skeleton';
import { UsageSkeleton } from './usage-skeleton';
import { SettingsSkeleton } from './settings-skeleton';
import { SecuritySkeleton } from './security-skeleton';
import { IntegrationsSkeleton } from './integrations-skeleton';
import { KnowledgeSkeleton } from './knowledge-skeleton';

interface AppShellSkeletonProps {
  pathname: string;
}

export function AppShellSkeleton({ pathname }: AppShellSkeletonProps) {
  const isFullBleed = pathname === '/inbox' || pathname.startsWith('/inbox');

  const renderRouteSkeleton = () => {
    if (pathname === '/inbox' || pathname.startsWith('/inbox')) {
      return <InboxSkeleton />;
    }
    if (pathname === '/dashboard') {
      return <DashboardSkeleton />;
    }
    if (pathname === '/leads') {
      return <LeadsSkeleton />;
    }
    if (pathname.startsWith('/leads/')) {
      return <LeadDetailSkeleton />;
    }
    if (pathname === '/pipeline') {
      return <PipelineSkeleton />;
    }
    if (pathname === '/appointments') {
      return <AppointmentsSkeleton />;
    }
    if (pathname === '/tasks') {
      return <TasksSkeleton />;
    }
    if (pathname === '/automations' || pathname.startsWith('/automations/')) {
      return <AutomationsSkeleton />;
    }
    if (pathname === '/campaigns' || pathname.startsWith('/campaigns/')) {
      return <CampaignsSkeleton />;
    }
    if (pathname === '/properties') {
      return <PropertiesSkeleton />;
    }
    if (pathname === '/team') {
      return <TeamSkeleton />;
    }
    if (pathname === '/roles') {
      return <RolesSkeleton />;
    }
    if (pathname === '/billing') {
      return <BillingSkeleton />;
    }
    if (pathname === '/usage') {
      return <UsageSkeleton />;
    }
    if (pathname === '/settings') {
      return <SettingsSkeleton />;
    }
    if (pathname === '/security') {
      return <SecuritySkeleton />;
    }
    if (pathname === '/integrations') {
      return <IntegrationsSkeleton />;
    }
    if (pathname === '/knowledge') {
      return <KnowledgeSkeleton />;
    }
    if (pathname === '/reports') {
      return <DashboardSkeleton />;
    }
    if (pathname === '/audit') {
      return (
        <div className="space-y-6">
          <PageHeaderSkeleton actionCount={0} />
          <TableSkeleton rows={8} columns={5} />
        </div>
      );
    }
    // Generic fallback for any other nested app route
    return (
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <TableSkeleton rows={6} columns={4} />
      </div>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden" aria-busy="true" aria-label="Loading workspace">
      {/* Sidebar skeleton with CSS variable width to prevent any layout shifts */}
      <aside
        className="hidden shrink-0 lg:flex flex-col bg-sidebar text-sidebar-foreground transition-none border-r border-sidebar-border"
        style={{ width: 'var(--sidebar-width, 248px)' }}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <div className="h-4 w-4 rounded-sm bg-primary/40 animate-pulse" />
            </div>
            <div className="h-4 w-24 rounded bg-sidebar-accent animate-pulse" />
          </div>
        </div>
        <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-3 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 rounded-md px-2.5">
              <div className="h-4 w-4 shrink-0 rounded bg-sidebar-accent animate-pulse" />
              <div className="h-3 flex-1 rounded bg-sidebar-accent/70 animate-pulse" />
            </div>
          ))}
          <div className="pt-4 pb-1">
            <div className="mx-2 h-px bg-sidebar-border" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 rounded-md px-2.5">
              <div className="h-4 w-4 shrink-0 rounded bg-sidebar-accent animate-pulse" />
              <div className="h-3 flex-1 rounded bg-sidebar-accent/70 animate-pulse" />
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header Skeleton matching AppShell */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-header px-3 sm:px-5">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="ml-2 hidden h-9 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-background px-3 md:flex">
            <Skeleton className="h-3.5 w-3.5 rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </header>

        {/* Route-Faithful Content Skeleton */}
        <main
          className={cn(
            'min-h-0 flex-1 focus:outline-none',
            isFullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto px-4 py-5 sm:px-6 sm:py-6'
          )}
        >
          {renderRouteSkeleton()}
        </main>
      </div>
    </div>
  );
}
