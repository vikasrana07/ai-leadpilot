import { api } from './api';

export type CustomRequestInit = RequestInit & {
  params?: Record<string, unknown>;
};

/**
 * Custom fetch instance used by Orval-generated React Query hooks.
 * Delegates to the existing robust `api<T>()` client to preserve cookie credentials,
 * automatic token refreshing on 401, billing redirects on 402, and CSRF protection.
 */
export async function customInstance<T>(
  url: string,
  options?: CustomRequestInit,
): Promise<T> {
  const method = options?.method ?? 'GET';
  let targetUrl = url;

  if (options?.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            searchParams.append(key, String(item));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + queryString;
    }
  }

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

  return api<T>(targetUrl, {
    method,
    body,
    headers,
    signal: options?.signal,
  });
}

/**
 * Orval's body-carrying calls reference a `getHeaders` helper it does not define for the custom client,
 * so it is provided here and imported by the generated files (see `override.header` in orval.config.cjs).
 */
export function getHeaders(
  ...sources: (RequestInit['headers'] | Record<string, string | undefined>)[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    const entries = source instanceof Headers ? [...source.entries()] : Array.isArray(source) ? source : Object.entries(source);
    for (const [k, v] of entries) {
      if (v !== undefined) out[k.toLowerCase()] = String(v);
    }
  }
  return out;
}

export default customInstance;
