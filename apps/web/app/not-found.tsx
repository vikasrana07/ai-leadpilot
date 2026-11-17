import type { Metadata } from 'next';
import { ErrorView } from '@/components/error-view';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return <ErrorView kind="not-found" />;
}
