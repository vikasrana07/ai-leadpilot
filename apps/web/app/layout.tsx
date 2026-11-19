import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { SIDEBAR_INIT_SCRIPT } from '@/lib/sidebar-state';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LeadPilot', template: '%s · LeadPilot' },
  description: 'Never lose a lead to a missed enquiry, a slow reply or a forgotten follow-up.',
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f6f7f9' }, { media: '(prefers-color-scheme: dark)', color: '#0a0d13' }],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const initialSidebarCollapsed = cookieStore.get('lp-sidebar-collapsed')?.value === '1';

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${initialSidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint: applies persisted theme and sidebar state so there is no layout shift or flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body><Providers initialSidebarCollapsed={initialSidebarCollapsed}>{children}</Providers></body>
    </html>
  );
}
