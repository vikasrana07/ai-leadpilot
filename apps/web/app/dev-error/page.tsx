'use client';

import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api';

/**
 * Development-only: throws while rendering so the error screen can be seen and tested. In a production build the condition is a compile-time
 * constant, the throwing branch is removed, and this route is an ordinary 404.
 */
export default function DevError() {
  if (process.env.NODE_ENV === 'production') notFound();
  throw new ApiError(500, 'internal_error', 'Deliberate test error', undefined, 'req-dev-error-demo');
}
