import { Global, Module } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { OpsModule } from '../ops/ops.module.js';
import { BillingController, RazorpayWebhookController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { EntitlementsService } from './entitlements.service.js';
import { PlanGuard } from './plan.guard.js';
import { BILLING_PROVIDER, LiveBillingProvider, MockBillingProvider } from './provider.js';

/** Entitlements are needed by many modules (messaging, team, AI, automations), so they live in a tiny global module with no module dependencies. */
@Global()
@Module({ providers: [EntitlementsService, PlanGuard], exports: [EntitlementsService, PlanGuard] })
export class EntitlementsModule {}

@Module({
  imports: [OpsModule],
  controllers: [BillingController, RazorpayWebhookController],
  providers: [
    BillingService, LiveBillingProvider, MockBillingProvider,
    { provide: BILLING_PROVIDER, inject: [ENV, LiveBillingProvider, MockBillingProvider], useFactory: (env: Env, live: LiveBillingProvider, mock: MockBillingProvider) => (env.RAZORPAY_MODE === 'live' ? live : mock) },
  ],
  exports: [BillingService],
})
export class BillingModule {}
