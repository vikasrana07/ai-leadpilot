import { api } from './api';

/**
 * Custom fetch instance used by Orval-generated React Query hooks.
 * Delegates to the existing robust `api<T>()` client to preserve cookie credentials,
 * automatic token refreshing on 401, billing redirects on 402, and CSRF protection.
 */
export async function customInstance<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const method = options?.method ?? 'GET';
  let body: unknown = undefined;

  if (options?.body) {
    if (typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    } else {
      body = options.body;
    }
  }

  const headers: Record<string, string> = {};
  if (options?.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [k, v] of options.headers) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, options.headers);
    }
  }

  return api<T>(url, {
    method,
    body,
    headers,
  });
}

export default customInstance;
