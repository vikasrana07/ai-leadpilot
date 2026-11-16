import { series } from '../common/series.js';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { Prisma, PropertyStatus } from '@leadpilot/database';
import { propertyImportSchema, propertyListQuerySchema, propertySchema, propertyUpdateSchema, PROPERTY_STATUSES } from '@leadpilot/validation';
import type { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import { parseCsv } from '../common/csv.js';
import { fromMinor, toMinor } from '../common/money.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { parseMoney } from '../leads/lead-import.service.js';

type ListQuery = z.infer<typeof propertyListQuerySchema>;
type PropInput = z.infer<typeof propertySchema>;

const toDto = (p: Prisma.PropertyGetPayload<object>) => ({
  id: p.id, project: p.project, unitLabel: p.unitLabel, title: p.title, propertyType: p.propertyType, bedrooms: p.bedrooms, areaSqft: p.areaSqft,
  price: fromMinor(p.priceMinor), location: p.location, status: p.status, createdAt: p.createdAt.toISOString(),
});

const HEADERS: Record<string, string> = {
  project: 'project', 'project name': 'project', unit: 'unitLabel', 'unit no': 'unitLabel', 'unit label': 'unitLabel', title: 'title', name: 'title',
  type: 'propertyType', 'property type': 'propertyType', bedrooms: 'bedrooms', bhk: 'bedrooms', area: 'areaSqft', 'area sqft': 'areaSqft', 'carpet area': 'areaSqft',
  price: 'price', 'price inr': 'price', location: 'location', area_name: 'location', locality: 'location', status: 'status',
};

@Injectable()
export class PropertiesService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}

  private rec(ctx: TenantRequestContext, tx: Parameters<AuditService['record']>[0], action: string, id: string | null, metadata: Record<string, string | number> = {}) {
    return this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action, resourceType: 'property', ...(id ? { resourceId: id } : {}), metadata, requestId: ctx.requestId, ip: ctx.ip });
  }

  /** Also used by the AI `search_properties` tool in phase 4: structured facts come from here, never from vector search. */
  where(tenantId: string, q: Partial<ListQuery>): Prisma.PropertyWhereInput {
    return {
      tenantId, deletedAt: null,
      ...(q.status ? { status: q.status } : {}), ...(q.propertyType ? { propertyType: { equals: q.propertyType, mode: 'insensitive' } } : {}),
      ...(q.location ? { location: { contains: q.location, mode: 'insensitive' } } : {}), ...(q.bedrooms !== undefined ? { bedrooms: q.bedrooms } : {}),
      ...(q.minPrice !== undefined || q.maxPrice !== undefined ? { priceMinor: { ...(q.minPrice !== undefined ? { gte: toMinor(q.minPrice) as bigint } : {}), ...(q.maxPrice !== undefined ? { lte: toMinor(q.maxPrice) as bigint } : {}) } } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { project: { contains: q.q, mode: 'insensitive' } }, { location: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
  }

  list(ctx: TenantRequestContext, q: ListQuery) {
    return this.db.tenantTx(ctx, async (tx) => {
      const where = this.where(ctx.tenantId, q);
      const [total, rows] = await series([ () => tx.property.count({ where }), () => tx.property.findMany({ where, orderBy: [{ project: 'asc' }, { unitLabel: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
      return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
    });
  }

  create(ctx: TenantRequestContext, i: PropInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      const p = await tx.property.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, project: i.project, unitLabel: i.unitLabel, title: i.title, propertyType: i.propertyType, bedrooms: i.bedrooms ?? null, areaSqft: i.areaSqft ?? null, priceMinor: toMinor(i.price) as bigint, location: i.location, status: i.status } });
      await this.rec(ctx, tx, 'property.created', p.id);
      return toDto(p);
    });
  }

  update(ctx: TenantRequestContext, id: string, i: Partial<PropInput>) {
    return this.db.tenantTx(ctx, async (tx) => {
      const exists = await tx.property.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, select: { id: true } });
      if (!exists) throw new NotFoundException({ code: 'not_found', message: 'Property not found' });
      const { price, ...rest } = i;
      const p = await tx.property.update({ where: { id }, data: { ...rest, ...(price !== undefined ? { priceMinor: toMinor(price) as bigint } : {}) } });
      await this.rec(ctx, tx, 'property.updated', id, { fields: Object.keys(i).join(',') });
      return toDto(p);
    });
  }

  remove(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const r = await tx.property.updateMany({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Property not found' });
      await this.rec(ctx, tx, 'property.deleted', id);
    });
  }

  async importCsv(ctx: TenantRequestContext, input: z.infer<typeof propertyImportSchema>) {
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw new BadRequestException({ code: 'empty_csv', message: 'The file needs a header row and at least one property' });
    if (rows.length - 1 > 5000) throw new BadRequestException({ code: 'too_many_rows', message: 'Import up to 5000 properties at a time' });
    const cols = (rows[0] as string[]).map((h) => HEADERS[h.trim().toLowerCase()]);
    for (const need of ['project', 'price', 'location']) if (!cols.includes(need)) throw new BadRequestException({ code: 'missing_column', message: `The file needs a "${need}" column` });
    const valid: PropInput[] = [];
    const invalid: { row: number; errors: string[] }[] = [];
    rows.slice(1).forEach((cells, idx) => {
      const get = (f: string) => { const i = cols.indexOf(f); return i >= 0 ? (cells[i] ?? '').trim() : ''; };
      const errors: string[] = [];
      const price = parseMoney(get('price'));
      if (price === null || price <= 0) errors.push(`Price "${get('price')}" is not valid`);
      const status = (get('status') || 'AVAILABLE').toUpperCase();
      if (!(PROPERTY_STATUSES as readonly string[]).includes(status)) errors.push(`Unknown status "${get('status')}"`);
      const bedrooms = get('bedrooms') ? Number(get('bedrooms').replace(/\D/g, '')) : null;
      const area = get('areaSqft') ? Number(get('areaSqft').replace(/[^\d.]/g, '')) : null;
      const parsed = propertySchema.safeParse({ project: get('project'), unitLabel: get('unitLabel') || null, title: get('title') || `${get('project')} ${get('unitLabel')}`.trim(), propertyType: get('propertyType') || 'Apartment', bedrooms: bedrooms && !Number.isNaN(bedrooms) ? bedrooms : null, areaSqft: area && !Number.isNaN(area) ? Math.round(area) : null, price: price ?? 0, location: get('location'), status });
      if (!parsed.success) errors.push(...parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
      if (errors.length || !parsed.success) invalid.push({ row: idx + 2, errors }); else valid.push(parsed.data);
    });
    if (input.dryRun || valid.length === 0) return { dryRun: input.dryRun, totalRows: rows.length - 1, valid: valid.length, invalid, created: 0 };
    return this.db.tenantTx(ctx, async (tx) => {
      await tx.property.createMany({ data: valid.map((v) => ({ id: uuidv7(), tenantId: ctx.tenantId, project: v.project, unitLabel: v.unitLabel, title: v.title, propertyType: v.propertyType, bedrooms: v.bedrooms ?? null, areaSqft: v.areaSqft ?? null, priceMinor: toMinor(v.price) as bigint, location: v.location, status: v.status as PropertyStatus })) });
      await this.rec(ctx, tx, 'property.imported', null, { created: valid.length, invalid: invalid.length });
      return { dryRun: false, totalRows: rows.length - 1, valid: valid.length, invalid, created: valid.length };
    });
  }
}

@Controller('properties')
class PropertiesController {
  constructor(@Inject(PropertiesService) private readonly svc: PropertiesService) {}
  @Get() @RequirePermissions('property:read') list(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(propertyListQuerySchema)) q: ListQuery) { return this.svc.list(ctx, q); }
  @Post() @HttpCode(201) @RequirePermissions('property:manage') create(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(propertySchema)) b: PropInput) { return this.svc.create(ctx, b); }
  @Post('import') @HttpCode(200) @RequirePermissions('property:manage') import(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(propertyImportSchema)) b: z.infer<typeof propertyImportSchema>) { return this.svc.importCsv(ctx, b); }
  @Patch(':id') @RequirePermissions('property:manage') update(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(propertyUpdateSchema)) b: Partial<PropInput>) { return this.svc.update(ctx, id, b); }
  @Delete(':id') @HttpCode(204) @RequirePermissions('property:manage') remove(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.remove(ctx, id); }
}

@Module({ controllers: [PropertiesController], providers: [PropertiesService], exports: [PropertiesService] })
export class PropertiesModule {}
