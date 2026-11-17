'use client';

import { useEffect } from 'react';
import { ErrorView, errorReference } from '@/components/error-view';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

/** Last resort when the root layout itself fails: replaces it, so it brings its own <html>, styles and theme script. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body><ErrorView kind="error" reference={errorReference(error)} onRetry={reset} /></body>
    </html>
  );
}
