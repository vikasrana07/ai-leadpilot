import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client.js';

export * from './generated/client.js';

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type TxClient = Prisma.TransactionClient;

export interface TenantContext {
  /** Set from the authenticated, validated membership. NEVER from request input. */
  tenantId: string | null;
  userId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction with `app.tenant_id` / `app.user_id` set transaction-locally, so PostgreSQL RLS
 * policies see the tenant. This is the ONLY sanctioned way to touch tenant tables from application code.
 * Transaction-local settings are safe with transaction-mode connection pooling.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TxClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  if (ctx.tenantId !== null && !UUID_RE.test(ctx.tenantId)) throw new Error('Invalid tenant id');
  if (ctx.userId && !UUID_RE.test(ctx.userId)) throw new Error('Invalid user id');
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 15_000, maxWait: options?.maxWait ?? 5_000 },
  );
}
