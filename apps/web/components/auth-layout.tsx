import { CheckCircle2, Clock, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

const POINTS = [
  { icon: Clock, title: 'Reply in seconds', text: 'Every enquiry is answered the moment it lands, day or night.' },
  { icon: CheckCircle2, title: 'Know who is serious', text: 'Leads are scored from what they actually tell you.' },
  { icon: MessageCircle, title: 'Nothing slips', text: 'Follow-ups and site visits are scheduled, not remembered.' },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <a href="#main" className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <Logo tone="light" />
        <div className="max-w-md">
          <p className="text-display text-white">Never lose a customer to a missed enquiry.</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent"><p.icon className="h-4 w-4 text-primary" aria-hidden /></span>
                <span><span className="text-heading block text-white">{p.title}</span><span className="text-sidebar-muted">{p.text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-helper !text-sidebar-muted">© LeadPilot</p>
      </aside>
      <main id="main" tabIndex={-1} className="flex items-center justify-center px-6 py-12 focus:outline-none">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-title">{title}</h1>
          {subtitle ? <p className="text-helper mt-1.5 !text-[13px]">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-6 text-center text-[13px] text-muted-foreground">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
