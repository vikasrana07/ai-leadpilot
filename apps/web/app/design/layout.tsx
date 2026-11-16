import type { ReactNode } from 'react';

export const metadata = { title: 'Design preview', robots: { index: false } };

export default function DesignLayout({ children }: { children: ReactNode }) {
  return children;
}
