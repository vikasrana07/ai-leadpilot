import { Body, Controller, Get, Inject, Patch, Put } from '@nestjs/common';
import { assignmentSettingsSchema, onboardingProgressSchema, updateTenantSchema, type OnboardingProgress, type UpdateTenantInput } from '@leadpilot/validation';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TenantsService } from './tenants.service.js';

@Controller('tenant')
export class TenantsController {
  constructor(@Inject(TenantsService) private readonly tenants: TenantsService) {}

  @Get()
  get(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tenants.get(ctx);
  }

  @Patch()
  @RequirePermissions('settings:manage')
  update(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(updateTenantSchema)) body: UpdateTenantInput) {
    return this.tenants.update(ctx, body);
  }

  @Get('assignment')
  assignment(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tenants.getAssignment(ctx);
  }

  @Put('assignment')
  @RequirePermissions('settings:manage')
  setAssignment(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(assignmentSettingsSchema)) body: { strategy: 'manual' | 'round_robin' }) {
    return this.tenants.setAssignment(ctx, body.strategy);
  }

  @Get('onboarding')
  onboarding(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tenants.getOnboarding(ctx);
  }

  @Put('onboarding')
  @RequirePermissions('settings:manage')
  saveOnboarding(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(onboardingProgressSchema)) body: OnboardingProgress) {
    return this.tenants.saveOnboarding(ctx, body);
  }
}
