import { Controller, Get, Global, Header, Inject, Module, Query, Res } from '@nestjs/common';
import { auditQuerySchema } from '@leadpilot/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { AuditService } from './audit.service.js';

type AuditQuery = z.infer<typeof auditQuerySchema>;

const exportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

@Controller('audit-logs')
class AuditController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

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

  @Get('export')
  @RequirePermissions('audit:read')
  @Header('Cache-Control', 'no-store')
  async exportWorm(
    @CurrentTenant() ctx: TenantRequestContext,
    @Query(new ZodPipe(exportQuerySchema)) q: z.infer<typeof exportQuerySchema>,
    @Res() res: Response,
  ): Promise<void> {
    const { content, manifest } = await this.audit.exportWorm(ctx.tenantId, {
      ...(q.from ? { from: new Date(q.from) } : {}),
      ...(q.to ? { to: new Date(q.to) } : {}),
      actorUserId: ctx.userId,
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx.ip ? { ip: ctx.ip } : {}),
    });
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-worm-${new Date().toISOString().slice(0, 10)}.jsonl"`);
    res.setHeader('X-Audit-Chain-Root', manifest.rootHash);
    res.setHeader('X-Audit-Signature', manifest.signature);
    res.send(content);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
