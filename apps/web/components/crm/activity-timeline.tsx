import {
  ArrowRightLeft,
  CircleDot,
  FilePlus2,
  GitMerge,
  Mail,
  MailCheck,
  MailOpen,
  MailWarning,
  MessageSquarePlus,
  MousePointerClick,
  PenLine,
  Tag,
  UserCheck,
} from 'lucide-react';
import { timeAgo } from '@/lib/format';
import { useTerms } from '@/lib/pack';

export interface ActivityItem { id: string; type: string; data: Record<string, unknown>; actor: string | null; createdAt: string }

const META: Record<string, { icon: typeof CircleDot; label: (d: Record<string, unknown>, lead: string) => string }> = {
  created: { icon: FilePlus2, label: (d, lead) => `${lead.charAt(0).toUpperCase()}${lead.slice(1)} created${d.source && d.source !== 'manual' ? ` via ${String(d.source).replace('_', ' ')}` : ''}` },
  assigned: { icon: UserCheck, label: (d) => (d.to ? 'Assigned to a team member' : 'Unassigned') },
  updated: { icon: PenLine, label: (d) => `Updated ${Array.isArray(d.fields) ? (d.fields as string[]).join(', ') : 'details'}` },
  stage_changed: { icon: ArrowRightLeft, label: (d) => `Moved from ${String(d.from)} to ${String(d.to)}` },
  note_added: { icon: MessageSquarePlus, label: (d) => `Added a note: “${String(d.preview ?? '')}”` },
  tags_changed: { icon: Tag, label: (d) => (Array.isArray(d.set) ? `Tags set to ${(d.set as string[]).join(', ') || 'none'}` : `Tags changed${Array.isArray(d.added) ? `: +${(d.added as string[]).join(', +')}` : ''}${Array.isArray(d.removed) ? ` −${(d.removed as string[]).join(', −')}` : ''}`) },
  merged: { icon: GitMerge, label: (d) => `Merged duplicate${Array.isArray(d.sourceNames) && d.sourceNames.length > 1 ? 's' : ''}: ${Array.isArray(d.sourceNames) ? (d.sourceNames as string[]).join(', ') : ''}` },
  enquiry_received: { icon: MessageSquarePlus, label: (d) => `New enquiry received${d.message ? `: “${String(d.message)}”` : ''}` },
  email_sent: { icon: Mail, label: (d, lead) => `Sent email: “${String(d.subject ?? 'Email')}” to ${String(d.recipient ?? lead)}` },
  email_delivered: { icon: MailCheck, label: (d) => `Email delivered: “${String(d.subject ?? 'Email')}”` },
  email_opened: { icon: MailOpen, label: (d) => `Opened email: “${String(d.subject ?? 'Email')}”${d.openCount && Number(d.openCount) > 1 ? ` (${d.openCount} times)` : ''}` },
  email_clicked: { icon: MousePointerClick, label: (d) => `Clicked link in email${d.url ? `: ${String(d.url)}` : ''}` },
  email_bounced: { icon: MailWarning, label: (d) => `Email bounced${d.bounceType ? ` (${String(d.bounceType)})` : ''}: “${String(d.subject ?? 'Email')}”` },
  email_complained: { icon: MailWarning, label: (d) => `Spam complaint registered for email: “${String(d.subject ?? 'Email')}”` },
};

export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  const terms = useTerms();
  if (items.length === 0) return <p className="text-helper py-8 text-center">No activity yet.</p>;
  return (
    <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
      {items.map((a) => {
        const m = META[a.type] ?? { icon: CircleDot, label: () => a.type.replace(/_/g, ' ') };
        return (
          <li key={a.id} className="relative flex gap-3.5">
            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface"><m.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /></span>
            <div className="min-w-0 flex-1"><p className="text-[13px]">{m.label(a.data, terms.lead)}</p><p className="text-helper">{a.actor ?? 'System'}</p></div>
            <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()} className="text-helper num whitespace-nowrap">{timeAgo(a.createdAt)}</time>
          </li>
        );
      })}
    </ol>
  );
}
