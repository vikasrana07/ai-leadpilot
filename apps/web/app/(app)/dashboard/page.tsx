'use client';

import type { OnboardingProgress } from '@leadpilot/validation';
import { ONBOARDING_STEPS } from '@leadpilot/validation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const LABELS: Record<string, string> = {
  business: 'Business details', industry: 'Industry', team: 'Invite your team', whatsapp: 'Connect WhatsApp',
  assistant: 'Configure the AI assistant', knowledge: 'Upload knowledge documents', qualification: 'Lead qualification rules',
};

export default function DashboardPage() {
  const { ctx, activeWorkspace } = useAuth();
  const onboarding = useQuery({ queryKey: ['tenant', 'onboarding'], queryFn: () => api<OnboardingProgress>('/tenant/onboarding') });
  const steps = ONBOARDING_STEPS.filter((s) => s !== 'complete');
  const done = new Set([...(onboarding.data?.completed ?? []), ...(onboarding.data?.skipped ?? [])]);
  const finished = onboarding.data?.step === 'complete';

  return (
    <>
      <PageHeader title={`Welcome, ${ctx.user.name.split(' ')[0]}`} description={`${activeWorkspace?.name ?? 'Your workspace'} is ready. Lead metrics appear here once leads start coming in (phase 2).`} />
      {onboarding.isPending ? <Skeleton className="h-64" /> : finished ? (
        <Card><CardBody className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /><p className="text-[13px]">Setup is complete. Dashboards for leads, conversations and appointments will appear here as those modules ship.</p></CardBody></Card>
      ) : (
        <Card>
          <CardHeader>
            <div><CardTitle>Finish setting up</CardTitle><p className="text-helper mt-0.5">{done.size} of {steps.length} steps done</p></div>
            <Button asChild variant="primary" size="sm"><Link href="/onboarding">Continue setup <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
          </CardHeader>
          <CardBody>
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done.size} aria-valuemin={0} aria-valuemax={steps.length}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(done.size / steps.length) * 100}%` }} />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {steps.map((s) => (
                <li key={s} className="flex items-center gap-2.5 text-[13px]">
                  {done.has(s) ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4 text-border-strong" aria-hidden />}
                  <span className={done.has(s) ? 'text-muted-foreground line-through' : ''}>{LABELS[s]}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
