import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { billingProfileSchema, cancelSubscriptionSchema, subscribeSchema, type BillingProfileInput } from '@leadpilot/validation';
import { z } from 'zod';
import { BillingExempt } from '../common/billing-meta.js';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { BillingService } from './billing.service.js';

const simulateSchema = z.object({ kind: z.enum(['activated', 'charged', 'pending', 'halted', 'cancelled', 'completed', 'payment_failed']) });

/** Billing keeps working when the workspace is read-only: that is how a lapsed customer pays. */
@Controller('billing') @BillingExempt()
export class BillingController {
  constructor(@Inject(BillingService) private readonly svc: BillingService) {}

  /** Any member: drives the trial/past-due banners and the plan-aware UI. */
  @Get('summary') summary(@CurrentTenant() c: TenantRequestContext) { return this.svc.summary(c); }
  @Get('plans') plans() { return this.svc.plans(); }

  @Get('profile') @RequirePermissions('billing:manage') profile(@CurrentTenant() c: TenantRequestContext) { return this.svc.getProfile(c); }
  @Put('profile') @RequirePermissions('billing:manage') saveProfile(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(billingProfileSchema)) b: BillingProfileInput) { return this.svc.saveProfile(c, b); }

  @Post('subscribe') @HttpCode(200) @RequirePermissions('billing:manage') subscribe(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(subscribeSchema)) b: { planKey: string }) { return this.svc.subscribe(c, b.planKey); }
  @Post('change-plan') @HttpCode(200) @RequirePermissions('billing:manage') change(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(subscribeSchema)) b: { planKey: string }) { return this.svc.changePlan(c, b.planKey); }
  @Post('cancel') @HttpCode(200) @RequirePermissions('billing:manage') cancel(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(cancelSubscriptionSchema)) _b: unknown) { return this.svc.cancel(c); }

  @Get('invoices') @RequirePermissions('billing:manage') invoices(@CurrentTenant() c: TenantRequestContext) { return this.svc.invoices(c); }
  @Get('invoices/:id') @RequirePermissions('billing:manage') invoice(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.invoice(c, id); }

  /** Local/dev only (404 with a live provider or in production). Pushes a signed event through the real webhook code. */
  @Post('mock/simulate') @HttpCode(200) @RequirePermissions('billing:manage') simulate(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(simulateSchema)) b: z.infer<typeof simulateSchema>) { return this.svc.simulate(c, b.kind); }
}

@Controller('webhooks/razorpay')
export class RazorpayWebhookController {
  constructor(@Inject(BillingService) private readonly svc: BillingService) {}

  /** Signature over the raw bytes, de-duplicated by event id, idempotent handlers. A 5xx makes Razorpay retry; a bad signature is a 401. */
  @Public() @Post() @HttpCode(200)
  receive(@Req() req: AppRequest & { rawBody?: Buffer }, @Headers('x-razorpay-signature') signature: string | undefined, @Headers('x-razorpay-event-id') eventId: string | undefined) {
    return this.svc.handleWebhook(req.rawBody ?? Buffer.alloc(0), signature, eventId);
  }
}
