import { BarChart3, Webhook, ListChecks, BookOpen, Building2, CalendarDays, CreditCard, Gauge, Inbox, KanbanSquare, KeyRound, LayoutDashboard, type LucideIcon, ScrollText, Settings, ShieldCheck, Sparkles, Users, UsersRound, Workflow, Plug } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase in which this module becomes functional. Items for later phases render as "Soon". */
  phase: number;
  permission?: string;
  description?: string;
}

export const CURRENT_PHASE = 6;

export const WORKSPACE_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, phase: 1 },
  { href: '/leads', label: 'Leads', icon: Users, phase: 2, description: 'Capture, search, score and assign every lead.' },
  { href: '/inbox', label: 'Inbox', icon: Inbox, phase: 3, permission: 'conversation:read:own', description: 'WhatsApp and website chat in one place.' },
  { href: '/pipeline', label: 'Sales Pipeline', icon: KanbanSquare, phase: 2, description: 'Move leads from first contact to closed.' },
  { href: '/properties', label: 'Properties', icon: Building2, phase: 2, permission: 'property:read' },
  { href: '/appointments', label: 'Appointments', icon: CalendarDays, phase: 5, description: 'Site visits and meetings without double booking.' },
  { href: '/ai-assistant', label: 'AI Assistant', icon: Sparkles, phase: 4, permission: 'ai:configure', description: 'Configure how your assistant talks and qualifies.' },
  { href: '/knowledge', label: 'Knowledge Base', icon: BookOpen, phase: 4, permission: 'knowledge:manage', description: 'Documents your assistant answers from.' },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, phase: 5, description: 'Follow-ups from you, your team and automations.' },
  { href: '/automations', label: 'Automations', icon: Workflow, phase: 5, description: 'Follow-ups and alerts that run on their own.' },
  { href: '/reports', label: 'Reports & Analytics', icon: BarChart3, phase: 6, permission: 'analytics:read:own', description: 'Conversion, response time and team performance.' },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/team', label: 'Team', icon: UsersRound, phase: 1, permission: 'team:read' },
  { href: '/roles', label: 'Roles & Permissions', icon: KeyRound, phase: 1, permission: 'team:read' },
  { href: '/integrations', label: 'Integrations', icon: Plug, phase: 2, permission: 'integration:manage', description: 'WhatsApp, website chat and calendars.' },
  { href: '/api-keys', label: 'API keys', icon: KeyRound, phase: 6, permission: 'integration:manage', description: 'Read and write your data from your own systems.' },
  { href: '/webhooks', label: 'Webhooks', icon: Webhook, phase: 6, permission: 'integration:manage', description: 'Signed events sent to your systems.' },
  { href: '/billing', label: 'Subscription & Billing', icon: CreditCard, phase: 6, permission: 'billing:manage', description: 'Plans, invoices and payment history.' },
  { href: '/usage', label: 'Usage', icon: Gauge, phase: 5, permission: 'usage:read', description: 'AI, messaging and storage consumption.' },
  { href: '/audit', label: 'Audit Logs', icon: ScrollText, phase: 1, permission: 'audit:read' },
  { href: '/security', label: 'Security', icon: ShieldCheck, phase: 1, description: 'Two-step verification for your account.' },
  { href: '/settings', label: 'Settings', icon: Settings, phase: 1 },
];

export const ALL_NAV = [...WORKSPACE_NAV, ...ADMIN_NAV];
export const ORG_ICON = Building2;
export const isLive = (item: NavItem): boolean => item.phase <= CURRENT_PHASE;
