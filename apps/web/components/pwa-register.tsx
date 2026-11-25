'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA Service Worker for offline asset caching and Web Push notifications.
 * Runs once on client mount.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Successfully registered service worker
          registration.update().catch(() => undefined);
        })
        .catch((error) => {
          // Non-blocking in dev/local environments
          if (process.env.NODE_ENV === 'development') {
            console.debug('Service worker registration:', error);
          }
        });
    }
  }, []);

  return null;
}
