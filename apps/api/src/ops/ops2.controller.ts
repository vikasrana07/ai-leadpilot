import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  automationDryRunSchema, automationEnableSchema, automationFromTemplateSchema, automationInputSchema, automationRunsQuerySchema, slaSettingsSchema, taskCreateSchema, taskListQuerySchema, taskUpdateSchema,
  type AutomationInput,
} from '@leadpilot/validation';
import { z } from 'zod';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AutomationsService } from './automations.service.js';
import { SlaService } from './sla.service.js';
import { TasksService } from './tasks.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller('automations') @RequirePermissions('automation:manage')
export class AutomationsController {
  constructor(@Inject(AutomationsService) private readonly svc: AutomationsService) {}
  @Get() list(@CurrentTenant() c: TenantRequestContext) { return this.svc.list(actorFrom(c)); }
  @Get('templates') templates(@CurrentTenant() c: TenantRequestContext) { return this.svc.templates(actorFrom(c)); }
  @Get('runs') runs(@CurrentTenant() c: TenantRequestContext, @Query(new ZodPipe(automationRunsQuerySchema)) q: z.infer<typeof automationRunsQuerySchema>) { return this.svc.runs(actorFrom(c), q); }
  @Post('runs/:id/retry') @HttpCode(200) retry(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.retryRun(actorFrom(c), id); }
  @Post('from-template') @HttpCode(201) fromTemplate(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(automationFromTemplateSchema)) b: { templateKey: string }) { return this.svc.fromTemplate(actorFrom(c), b.templateKey); }
  @Post() @HttpCode(201) create(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(automationInputSchema)) b: AutomationInput) { return this.svc.create(actorFrom(c), b); }
  @Get(':id') get(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.get(actorFrom(c), id); }
  @Put(':id') update(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(automationInputSchema)) b: AutomationInput) { return this.svc.update(actorFrom(c), id, b); }
  @Post(':id/enable') @HttpCode(200) enable(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(automationEnableSchema)) b: { enabled: boolean }) { return this.svc.setEnabled(actorFrom(c), id, b.enabled); }
  @Post(':id/dry-run') @HttpCode(200) dry(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(automationDryRunSchema)) b: { leadId: string; appointmentId?: string }) { return this.svc.dryRun(actorFrom(c), id, b.leadId, b.appointmentId); }
  @Delete(':id') @HttpCode(204) remove(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.remove(actorFrom(c), id); }
}

@Controller('tasks')
export class TasksController {
  constructor(@Inject(TasksService) private readonly svc: TasksService) {}
  @Get() list(@CurrentTenant() c: TenantRequestContext, @Query(new ZodPipe(taskListQuerySchema)) q: z.infer<typeof taskListQuerySchema>) { return this.svc.list(actorFrom(c), q); }
  @Post() @HttpCode(201) create(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(taskCreateSchema)) b: z.infer<typeof taskCreateSchema>) { return this.svc.create(actorFrom(c), b); }
  @Patch(':id') update(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(taskUpdateSchema)) b: z.infer<typeof taskUpdateSchema>) { return this.svc.update(actorFrom(c), id, b); }
  @Delete(':id') @HttpCode(204) remove(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.remove(actorFrom(c), id); }
}

@Controller('sla')
export class SlaController {
  constructor(@Inject(SlaService) private readonly svc: SlaService) {}
  @Get() get(@CurrentTenant() c: TenantRequestContext) { return this.svc.get(actorFrom(c)); }
  @Put() put(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(slaSettingsSchema)) b: z.infer<typeof slaSettingsSchema>) { return this.svc.update(actorFrom(c), b); }
}
