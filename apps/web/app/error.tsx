'use client';

import { useEffect } from 'react';
import { ErrorView, errorReference } from '@/components/error-view';

/** Catches errors thrown while rendering any page below the root layout; the layout (theme, providers) stays in place. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <ErrorView kind="error" reference={errorReference(error)} onRetry={reset} />;
}
