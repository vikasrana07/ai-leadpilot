import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, withTenant, type PrismaClient, type TxClient } from '@leadpilot/database';
import { ENV, PRISMA } from '../common/tokens.js';
import type { Env } from '../config/env.js';

@Injectable()
export class DbService implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) readonly prisma: PrismaClient) {}

  /** Tenant-scoped transaction: RLS sees `app.tenant_id`. The only way to touch tenant tables. */
  tenantTx<T>(ctx: { tenantId: string; userId?: string }, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId ?? null }, fn);
  }

  /** User-scoped transaction without an active tenant (workspace listing, invitation lookup). */
  userTx<T>(userId: string | null, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, { tenantId: null, userId }, fn);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    { provide: PRISMA, inject: [ENV], useFactory: (env: Env) => createPrismaClient(env.DATABASE_URL) },
    DbService,
  ],
  exports: [DbService, PRISMA],
})
export class DbModule {}
