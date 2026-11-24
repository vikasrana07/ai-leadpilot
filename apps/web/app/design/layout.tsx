import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export const metadata = { title: 'Design preview', robots: { index: false } };

/** Static design mock-ups with made-up data: for development only. In a production build these routes are an ordinary 404. */
export default function DesignLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
