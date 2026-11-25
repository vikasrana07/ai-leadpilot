import type { ScreenTour } from '../types';

export const WORKSPACE_ADMIN_TOURS: ScreenTour[] = [
  {
    id: 'team',
    route: '/team',
    title: 'Team',
    buildSteps: () => [
      {
        id: 'team-overview',
        title: 'Manage workspace members',
        description: 'Invite teammates, assign roles, and review active or pending seats.',
        placement: 'center',
      },
      {
        id: 'team-invite',
        target: 'team-invite',
        title: 'Invite a teammate',
        description: 'Send an email invite with a pre-assigned role so new members land with the right permissions.',
        placement: 'bottom',
      },
      {
        id: 'team-list',
        target: 'team-list',
        title: 'Members & role assignments',
        description: 'Update member roles, deactivate access, or resend pending invitations.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'roles',
    route: '/roles',
    title: 'Roles & Permissions',
    buildSteps: () => [
      {
        id: 'roles-overview',
        title: 'Role-based access control',
        description: 'Create custom roles or review built-in roles to control exactly what each team member can view and edit.',
        placement: 'center',
      },
      {
        id: 'roles-create',
        target: 'roles-create',
        title: 'Create a custom role',
        description: 'Define tailored permission sets for sales reps, managers, or view-only auditors.',
        placement: 'bottom',
      },
      {
        id: 'roles-list',
        target: 'roles-list',
        title: 'Permission matrix',
        description: 'Inspect and toggle granular permissions across CRM, Inbox, AI, Automations, and Billing.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'integrations',
    route: '/integrations',
    title: 'Integrations',
    buildSteps: () => [
      {
        id: 'integrations-overview',
        title: 'Connect channels & tools',
        description: 'Link WhatsApp Business, Website Chat widget, Email (SES), and Calendar sync in one place.',
        placement: 'center',
      },
      {
        id: 'integrations-cards',
        target: 'integrations-cards',
        title: 'Channel setup cards',
        description: 'Launch WhatsApp Embedded Signup, copy your website chat embed snippet, or test channel health.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'api-keys',
    route: '/api-keys',
    title: 'API Keys',
    buildSteps: () => [
      {
        id: 'api-keys-overview',
        title: 'Programmatic API access',
        description: 'Generate scoped API keys to push leads or sync data from your external systems.',
        placement: 'center',
      },
      {
        id: 'api-keys-create',
        target: 'api-keys-create',
        title: 'Create an API key',
        description: 'Name your key, pick its scopes, and copy the secret once upon creation.',
        placement: 'bottom',
      },
      {
        id: 'api-keys-list',
        target: 'api-keys-list',
        title: 'Active keys & revocation',
        description: 'Monitor last-used timestamps and revoke compromised or unused keys immediately.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'webhooks',
    route: '/webhooks',
    title: 'Webhooks',
    buildSteps: () => [
      {
        id: 'webhooks-overview',
        title: 'Real-time event webhooks',
        description: 'Subscribe external endpoints to signed LeadPilot events like lead creation, stage changes, or bookings.',
        placement: 'center',
      },
      {
        id: 'webhooks-create',
        target: 'webhooks-create',
        title: 'Add an endpoint',
        description: 'Configure the destination URL, choose subscribed events, and verify HMAC signatures using the signing secret.',
        placement: 'bottom',
      },
      {
        id: 'webhooks-list',
        target: 'webhooks-list',
        title: 'Endpoints & delivery logs',
        description: 'Inspect recent delivery attempts, HTTP status codes, and retry any failed payloads.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'billing',
    route: '/billing',
    title: 'Subscription & Billing',
    buildSteps: () => [
      {
        id: 'billing-overview',
        title: 'Plan & invoices',
        description: 'View your active subscription, upgrade plans, and download GST-compliant invoices.',
        placement: 'center',
      },
      {
        id: 'billing-plan',
        target: 'billing-plan',
        title: 'Current plan & upgrades',
        description: 'Compare plan tiers, seat limits, and monthly/annual billing options.',
        placement: 'bottom',
      },
      {
        id: 'billing-invoices',
        target: 'billing-invoices',
        title: 'Payment history',
        description: 'Review past charges and open printable invoices for accounting.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'usage',
    route: '/usage',
    title: 'Usage',
    buildSteps: () => [
      {
        id: 'usage-overview',
        title: 'Quota & consumption',
        description: 'Track monthly AI replies, WhatsApp conversations, email sends, and knowledge storage against your plan limits.',
        placement: 'center',
      },
      {
        id: 'usage-meters',
        target: 'usage-meters',
        title: 'Usage meters',
        description: 'Watch progress bars for each metered resource so you can upgrade before hitting a cap.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'audit',
    route: '/audit',
    title: 'Audit Logs',
    buildSteps: () => [
      {
        id: 'audit-overview',
        title: 'Workspace audit trail',
        description: 'Review an immutable log of sign-ins, permission changes, exports, and sensitive actions.',
        placement: 'center',
      },
      {
        id: 'audit-filters',
        target: 'audit-filters',
        title: 'Filter by actor or event',
        description: 'Narrow down events by team member, action type, or date range.',
        placement: 'bottom',
      },
      {
        id: 'audit-table',
        target: 'audit-table',
        title: 'Event details',
        description: 'Inspect timestamps, IP addresses, and affected resources for compliance reviews.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'security',
    route: '/security',
    title: 'Security',
    buildSteps: () => [
      {
        id: 'security-overview',
        title: 'Account & MFA security',
        description: 'Protect your account with two-step verification (TOTP) and manage active login sessions.',
        placement: 'center',
      },
      {
        id: 'security-mfa',
        target: 'security-mfa',
        title: 'Two-step verification',
        description: 'Enroll an authenticator app and store recovery codes safely.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'settings',
    route: '/settings',
    title: 'Settings',
    buildSteps: () => [
      {
        id: 'settings-overview',
        title: 'Workspace configuration',
        description: 'Configure business profile, SLA alerts, canned responses, SSO, and data-retention policies.',
        placement: 'center',
      },
      {
        id: 'settings-sections',
        target: 'settings-sections',
        title: 'Settings sections',
        description: 'Update workspace details, canned replies, SSO identity provider, privacy rules, or support access.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'onboarding',
    route: '/onboarding',
    title: 'Workspace Setup',
    buildSteps: (terms) => [
      {
        id: 'onboarding-overview',
        title: 'Guided workspace setup',
        description: `Complete these steps to configure your industry pack, team, WhatsApp channel, and AI ${terms.lead} qualification.`,
        placement: 'center',
      },
      {
        id: 'onboarding-steps',
        target: 'onboarding-steps',
        title: 'Step-by-step progress',
        description: 'Work through each step in order or skip optional steps and return anytime from the Dashboard.',
        placement: 'top',
      },
    ],
  },
];
