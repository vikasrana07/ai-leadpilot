import { Controller, Get, Header, Inject, Module, Param, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { reportQuerySchema, REPORT_KEYS, type ReportKey, type ReportQuery } from '@leadpilot/validation';
import { RequireFeature } from '../common/billing-meta.js';
import { formatCsv } from '../common/csv.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { ReportsService } from './reports.service.js';

const key = (k: string): ReportKey => { if (!(REPORT_KEYS as readonly string[]).includes(k)) throw new BadRequestException({ code: 'unknown_report', message: 'Unknown report' }); return k as ReportKey; };

/** Reports (own-scope for agents, workspace-wide for managers and owners). Every figure is computed live from tenant-scoped data. */
@Controller('reports') @RequirePermissions('analytics:read:own')
class ReportsController {
  constructor(@Inject(ReportsService) private readonly svc: ReportsService, @Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}

  @Get(':key') get(@CurrentTenant() c: TenantRequestContext, @Param('key') k: string, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) { return this.svc.run(c, key(k), q); }

  /** CSV of one table of a report (default: the first). Plan-gated (`csv_export`) and audited. Cells that look like formulas are neutralised. */
  @Get(':key/export') @RequireFeature('csv_export') @Header('Cache-Control', 'no-store')
  async export(@CurrentTenant() c: TenantRequestContext, @Param('key') k: string, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery, @Query('table') table: string | undefined, @Res() res: Response): Promise<void> {
    const r = await this.svc.run(c, key(k), q);
    const t = r.tables.find((x) => x.name === table) ?? r.tables[0];
    if (!t) throw new BadRequestException({ code: 'no_data', message: 'This report has no table to export' });
    const csv = formatCsv([t.columns.map((x) => x.label), ...t.rows.map((row) => t.columns.map((x) => row[x.key] ?? ''))]);
    await this.db.tenantTx(c, (tx) => this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'report.exported', resourceType: 'report', metadata: { report: k, table: t.name, rows: t.rows.length }, requestId: c.requestId, ip: c.ip }));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leadpilot-${k}-${t.name}.csv"`, 'X-Content-Type-Options': 'nosniff' });
    res.send(`\uFEFF${csv}`);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
