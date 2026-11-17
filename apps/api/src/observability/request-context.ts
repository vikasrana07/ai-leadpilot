import { AsyncLocalStorage } from 'node:async_hooks';

/** Ids attached to every log line written while handling one request or one background job. Ids only, never personal data. */
export interface LogContext { requestId?: string; tenantId?: string; userId?: string; jobId?: string }

const storage = new AsyncLocalStorage<LogContext>();

export const runWithLogContext = <T>(ctx: LogContext, fn: () => T): T => storage.run(ctx, fn);
export const getLogContext = (): LogContext | undefined => storage.getStore();

/** Fills in ids that become known later in the request (after authentication and tenant resolution). */
export function addLogContext(ids: Partial<LogContext>): void {
  const s = storage.getStore();
  if (!s) return;
  for (const [k, v] of Object.entries(ids)) if (typeof v === 'string' && v) (s as Record<string, string>)[k] = v;
}
