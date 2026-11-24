'use client';

import { ONBOARDING_STEPS, type OnboardingProgress, type OnboardingStep } from '@leadpilot/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Clock, MessageCircle, PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import OnboardingLoading from './loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { type Channel, ConnectDialog } from '@/components/integrations/whatsapp-card';
import { EmbeddedSignupButton, type EmbeddedConfig } from '@/components/integrations/embedded-signup-button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { handleApiError } from '@/lib/forms';
import { getAllTimezones } from '@/lib/i18n';
import { useTerms } from '@/lib/pack';
import { applyTerms } from '@/lib/terms-text';

interface Tenant { name: string; email: string; phone: string | null; website: string | null; address: string | null; industry: string; timezone: string; currency: string }

const STEPS: { key: Exclude<OnboardingStep, 'complete'>; title: string; blurb: string; phase?: number }[] = [
  { key: 'business', title: 'Business details', blurb: 'How customers and your team will see your business.' },
  { key: 'industry', title: 'Industry', blurb: 'We tailor fields, pipeline stages and AI prompts to your industry.' },
  { key: 'team', title: 'Invite your team', blurb: 'Add sales managers and agents. You can do this later too.' },
  { key: 'whatsapp', title: 'Connect WhatsApp', blurb: 'Reply to enquiries on WhatsApp.' },
  { key: 'assistant', title: 'Configure the AI assistant', blurb: 'Name, tone and rules for your assistant.', phase: 4 },
  { key: 'knowledge', title: 'Upload knowledge', blurb: 'Brochures and FAQs the assistant answers from.', phase: 4 },
  { key: 'qualification', title: 'Qualification rules', blurb: 'What makes a lead hot, warm or cold for you.', phase: 4 },
];
const INDUSTRY_OPTIONS = [
  { v: 'real_estate', label: 'Real estate' }, { v: 'coaching', label: 'Coaching & education' }, { v: 'healthcare', label: 'Healthcare clinic' },
  { v: 'home_services', label: 'Home services' }, { v: 'other', label: 'Something else' },
];

function BusinessStep({ tenant, onDone }: { tenant: Tenant; onDone: () => Promise<void> }) {
  const [v, setV] = useState({ name: tenant.name, phone: tenant.phone ?? '', website: tenant.website ?? '', timezone: tenant.timezone });
  const [busy, setBusy] = useState(false);
  const timezones = useMemo(() => getAllTimezones(), []);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { await api('/tenant', { method: 'PATCH', body: { name: v.name, phone: v.phone || null, website: v.website || null, timezone: v.timezone } }); await onDone(); } catch (err) { handleApiError(err); } finally { setBusy(false); }
    }}>
      <Field label="Business name" htmlFor="o-name"><Input id="o-name" required minLength={2} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Phone" htmlFor="o-phone"><Input id="o-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
      <Field label="Website" htmlFor="o-web" hint="Include https://"><Input id="o-web" type="url" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></Field>
      <Field label="Timezone" htmlFor="o-tz">
        <Select id="o-tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
          {timezones.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={busy}>Save and continue <ArrowRight className="h-4 w-4" aria-hidden /></Button></div>
    </form>
  );
}

function IndustryStep({ tenant, onDone }: { tenant: Tenant; onDone: () => Promise<void> }) {
  const [value, setValue] = useState(tenant.industry);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div role="radiogroup" aria-label="Industry" className="grid gap-3 sm:grid-cols-2">
        {INDUSTRY_OPTIONS.map((o) => (
          <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => setValue(o.v)} className={cn('flex items-center justify-between rounded-lg border p-4 text-left text-[13px] font-medium transition-colors', value === o.v ? 'border-primary bg-primary-soft text-accent-foreground' : 'border-border hover:bg-muted')}>
            {o.label}{value === o.v ? <Check className="h-4 w-4" aria-hidden /> : null}
          </button>
        ))}
      </div>
      <p className="text-helper mt-3">Real estate, coaching, clinics and home services each get their own pipeline stages, fields and wording. “Something else” starts with a general setup you can change. You can still edit stages and fields later.</p>
      <Button className="mt-5" variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await api('/tenant', { method: 'PATCH', body: { industry: value } }); await onDone(); } catch (e) { handleApiError(e); } finally { setBusy(false); } }}>Save and continue <ArrowRight className="h-4 w-4" aria-hidden /></Button>
    </div>
  );
}

function TeamStep({ onDone }: { onDone: () => Promise<void> }) {
  const { can, ctx } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'agent'>('agent');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const canInvite = can('team:invite');
  return (
    <div className="space-y-4">
      {!ctx.user.emailVerified ? <p className="rounded-lg border border-border bg-warning-soft p-3 text-[13px] text-warning">Verify your email first, then you can invite teammates. You can skip this step and come back.</p> : null}
      {canInvite && ctx.user.emailVerified ? (
        <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await api('/team/invitations', { method: 'POST', body: { email, roleKey: role } }); setSent((s) => [...s, email]); setEmail(''); toast.success('Invitation sent'); } catch (err) { handleApiError(err); } finally { setBusy(false); }
        }}>
          <Field label="Email" htmlFor="t-email" className="min-w-56 flex-1"><Input id="t-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role" htmlFor="t-role"><select id="t-role" value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'agent')} className="h-9 rounded-md border border-border bg-surface px-3 text-[13px]"><option value="agent">Sales Agent</option><option value="manager">Sales Manager</option></select></Field>
          <Button type="submit" loading={busy}>Send invite</Button>
        </form>
      ) : null}
      {sent.length ? <ul className="text-helper space-y-1">{sent.map((s) => <li key={s} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" aria-hidden />Invited {s}</li>)}</ul> : null}
      <Button variant="primary" loading={false} onClick={() => void onDone()}>{sent.length ? 'Continue' : 'Skip for now'} <ArrowRight className="h-4 w-4" aria-hidden /></Button>
    </div>
  );
}

function WhatsappStep({ onDone, onSkip }: { onDone: () => Promise<void>; onSkip: () => Promise<void> }) {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<Channel[]>('/channels') });
  const embedded = useQuery({ queryKey: ['channels', 'embedded-config'], queryFn: () => api<EmbeddedConfig>('/channels/embedded-signup'), retry: false });
  const [manualOpen, setManualOpen] = useState(false);

  const ch = channels.data?.[0];
  const isConnected = ch && (ch.status === 'ACTIVE' || ch.status === 'NEEDS_RECONNECT');
  const es = embedded.data && embedded.data.mode !== 'off' ? embedded.data : null;

  if (channels.isPending) return <Skeleton className="h-32" />;

  if (isConnected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <Check className="h-5 w-5 text-success" aria-hidden />
          <div className="flex-1">
            <p className="text-[13px] font-medium">{ch.name}</p>
            <p className="text-helper">{ch.displayPhone ?? ch.phoneNumberId} is connected</p>
          </div>
          <Badge tone="success">Connected</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void onDone()}>
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <MessageCircle className="mt-0.5 h-5 w-5 text-primary shrink-0" aria-hidden />
          <div className="flex-1 space-y-1">
            <p className="text-[13px] font-medium">Connect your WhatsApp Business number</p>
            <p className="text-helper">
              {es
                ? 'Sign in with Facebook to link your WhatsApp Business account in a few clicks. LeadPilot will automatically capture and reply to enquiries.'
                : 'Connect your WhatsApp Business Cloud API number. You can connect with Facebook or enter credentials manually.'}
            </p>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center gap-3">
          {es ? (
            <EmbeddedSignupButton
              config={es}
              label="Connect with Facebook"
              onConnected={async () => {
                await qc.invalidateQueries({ queryKey: ['channels'] });
                await onDone();
              }}
            />
          ) : null}
          <Button
            variant={es ? 'secondary' : 'primary'}
            onClick={() => setManualOpen(true)}
          >
            Enter credentials manually
          </Button>
          <Button variant="ghost" onClick={() => void onSkip()}>
            Skip for now <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <ConnectDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onConnected={async () => {
          await qc.invalidateQueries({ queryKey: ['channels'] });
          await onDone();
        }}
      />
    </div>
  );
}

export default function OnboardingPage() {
  const terms = useTerms();
  const qc = useQueryClient();
  const progress = useQuery({ queryKey: ['tenant', 'onboarding'], queryFn: () => api<OnboardingProgress>('/tenant/onboarding') });
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<Tenant>('/tenant') });
  // `selected` is only set when the user clicks a step; otherwise the saved server step is the active one (resume).
  const [selected, setSelected] = useState<OnboardingStep | null>(null);
  const active: OnboardingStep = selected ?? progress.data?.step ?? 'business';
  const setActive = setSelected;

  const persist = async (next: OnboardingProgress) => {
    try { await api('/tenant/onboarding', { method: 'PUT', body: next }); qc.setQueryData(['tenant', 'onboarding'], next); await qc.invalidateQueries({ queryKey: ['tenant'] }); setActive(next.step); } catch (e) { handleApiError(e); }
  };
  const advance = async (key: OnboardingStep, mode: 'completed' | 'skipped') => {
    const p = progress.data ?? { step: 'business' as const, completed: [], skipped: [] };
    const i = ONBOARDING_STEPS.indexOf(key);
    const nextStep = ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)] ?? 'complete';
    await persist({ step: nextStep, completed: mode === 'completed' ? [...new Set([...p.completed, key])] : p.completed, skipped: mode === 'skipped' ? [...new Set([...p.skipped, key])] : p.skipped });
  };

  if (progress.isPending || tenant.isPending) return <OnboardingLoading />;
  if (progress.isError || tenant.isError) return <p className="text-[13px] text-danger">Could not load your setup progress.</p>;
  const done = new Set([...progress.data.completed, ...progress.data.skipped]);
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === active));
  const step = STEPS[idx];
  const finished = active === 'complete';

  return (
    <>
      <PageHeader title="Set up your workspace" description="Pick up where you left off at any time. Your progress is saved." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ol className="space-y-1" aria-label="Setup steps">
          {STEPS.map((s, i) => {
            const isDone = done.has(s.key);
            const isActive = !finished && s.key === active;
            return (
              <li key={s.key}>
                <button onClick={() => setActive(s.key)} aria-current={isActive ? 'step' : undefined} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors', isActive ? 'bg-primary-soft font-medium text-accent-foreground' : 'hover:bg-muted')}>
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold', isDone ? 'border-success bg-success text-white' : isActive ? 'border-primary text-primary' : 'border-border-strong text-muted-foreground')}>{isDone ? <Check className="h-3 w-3" aria-hidden /> : i + 1}</span>
                  <span className="flex-1">{s.title}</span>
                  {s.phase && !isDone ? <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Available in a later phase" /> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <Card>
          <div className="h-1 overflow-hidden rounded-t-lg bg-muted"><motion.div className="h-full bg-primary" initial={false} animate={{ width: `${(finished ? 100 : (done.size / STEPS.length) * 100)}%` }} transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }} /></div>
          <CardBody>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={active} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.16 }}>
                {finished ? (
                  <div className="py-8 text-center"><PartyPopper className="mx-auto h-8 w-8 text-primary" aria-hidden /><h2 className="text-title mt-4">You are all set</h2><p className="text-helper mx-auto mt-1 max-w-sm">Your workspace is ready. Steps you skipped can be finished from Settings and Integrations as those modules ship.</p><Button asChild variant="primary" className="mt-6"><Link href="/dashboard">Go to dashboard</Link></Button></div>
                ) : step ? (
                  <div>
                    <p className="text-label text-muted-foreground">Step {idx + 1} of {STEPS.length}</p>
                    <h2 className="text-title mt-1">{step.title}</h2>
                    <p className="text-helper mb-6 mt-1 !text-[13px]">{applyTerms(step.blurb, terms)}</p>
                    {step.key === 'business' ? <BusinessStep tenant={tenant.data} onDone={() => advance('business', 'completed')} /> : null}
                    {step.key === 'industry' ? <IndustryStep tenant={tenant.data} onDone={() => advance('industry', 'completed')} /> : null}
                    {step.key === 'team' ? <TeamStep onDone={() => advance('team', 'completed')} /> : null}
                    {step.key === 'whatsapp' ? <WhatsappStep onDone={() => advance('whatsapp', 'completed')} onSkip={() => advance('whatsapp', 'skipped')} /> : null}
                    {step.phase ? (
                      <div className="rounded-lg border border-dashed border-border-strong p-5">
                        <p className="text-[13px]">This step needs a module that ships in phase {step.phase}. Nothing to configure yet, so you can skip it now and return when it is available.</p>
                        <Button className="mt-4" variant="primary" onClick={() => void advance(step.key, 'skipped')}>Skip for now <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden /></Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
