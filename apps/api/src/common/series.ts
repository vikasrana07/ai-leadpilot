/**
 * Runs queries one after another, returning a typed tuple like `Promise.all`.
 * Inside an interactive Prisma transaction there is ONE database connection, so "parallel" queries are really queued on it; issuing them
 * concurrently makes `pg` warn (and pg 9 removes that behaviour). Sequential execution has the same latency and no deprecated pattern.
 */
export async function series<const T extends readonly (() => PromiseLike<unknown>)[]>(fns: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
