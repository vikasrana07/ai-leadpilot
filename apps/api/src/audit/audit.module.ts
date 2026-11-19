import { Controller, Get, Global, Inject, Module, Query } from '@nestjs/common';
import { auditQuerySchema } from '@leadpilot/validation';
import type { z } from 'zod';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { AuditService } from './audit.service.js';

type AuditQuery = z.infer<typeof auditQuerySchema>;

@Controller('audit-logs')
class AuditController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get()
  @RequirePermissions('audit:read')
  async list(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(auditQuerySchema)) q: AuditQuery) {
    let cursorObj: { id_createdAt: { id: string; createdAt: Date } } | undefined;
    if (q.cursor) {
      const target = await this.db.tenantTx(ctx, (tx) =>
        tx.auditLog.findFirst({ where: { id: q.cursor }, select: { id: true, createdAt: true } }),
      );
      if (target) {
        cursorObj = { id_createdAt: { id: target.id, createdAt: target.createdAt } };
      }
    }

    const rows = await this.db.tenantTx(ctx, (tx) =>
      tx.auditLog.findMany({
        where: { ...(q.action ? { action: q.action } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(cursorObj ? { cursor: cursorObj, skip: 1 } : {}),
      }),
    );
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
