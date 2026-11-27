import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, RequirePermissions } from '../../common/decorators.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { GoogleSheetsService } from './google-sheets.service.js';

const connectSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });
const configSchema = z.object({
  spreadsheetId: z.string().trim().min(5).max(200),
  spreadsheetName: z.string().trim().max(160).optional(),
  sheetName: z.string().trim().min(1).max(100).default('Sheet1'),
  columnMapping: z
    .object({
      name: z.string().max(60).optional(),
      phone: z.string().max(60).optional(),
      email: z.string().max(60).optional(),
      location: z.string().max(60).optional(),
      requirements: z.string().max(60).optional(),
    })
    .default({}),
  enabled: z.boolean().default(true),
});

@Controller('integrations/google-sheets')
export class GoogleSheetsController {
  constructor(@Inject(GoogleSheetsService) private readonly sheets: GoogleSheetsService) {}

  @Get()
  @RequirePermissions('integration:manage')
  status(@CurrentTenant() ctx: TenantRequestContext) {
    return this.sheets.getStatus(ctx.tenantId);
  }

  @Get('auth-url')
  @RequirePermissions('integration:manage')
  authUrl(@CurrentTenant() ctx: TenantRequestContext) {
    return { url: this.sheets.getAuthUrl(ctx.tenantId) };
  }

  @Post('connect')
  @RequirePermissions('integration:manage')
  connect(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(connectSchema)) body: z.infer<typeof connectSchema>) {
    return this.sheets.connect(ctx.tenantId, body.code, body.state);
  }

  @Put('config')
  @RequirePermissions('integration:manage')
  configure(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>) {
    return this.sheets.configure(ctx.tenantId, {
      spreadsheetId: body.spreadsheetId,
      ...(body.spreadsheetName ? { spreadsheetName: body.spreadsheetName } : {}),
      sheetName: body.sheetName,
      columnMapping: body.columnMapping,
      enabled: body.enabled,
    });
  }

  @Post('sync-now')
  @HttpCode(200)
  @RequirePermissions('integration:manage')
  syncNow(@CurrentTenant() ctx: TenantRequestContext) {
    return this.sheets.syncNow(ctx.tenantId);
  }

  @Delete()
  @RequirePermissions('integration:manage')
  disconnect(@CurrentTenant() ctx: TenantRequestContext) {
    return this.sheets.disconnect(ctx.tenantId);
  }
}
