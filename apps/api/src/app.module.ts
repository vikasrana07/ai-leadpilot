import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AiModule } from './ai/ai.module.js';
import { AiTrigger } from './ai/ai-trigger.js';
import { RedisThrottlerStorage } from './common/redis-throttler.js';
import { BillingModule, EntitlementsModule } from './billing/billing.module.js';
import { PlanGuard } from './billing/plan.guard.js';
import { SupportModule } from './support/support.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { V1Module } from './v1/v1.module.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { MfaModule } from './mfa/mfa.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CaptureModule } from './capture/capture.module.js';
import { ChannelsModule } from './channels/channels.module.js';
import { ConfigModule } from './common/config.module.js';
import { AllExceptionsFilter } from './common/http-exception.filter.js';
import { AuthGuard, PermissionsGuard, TenantGuard } from './common/guards.js';
import { accessLogMiddleware, csrfOriginMiddleware, httpMetricsMiddleware, requestIdMiddleware } from './common/middleware.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { ENV } from './common/tokens.js';
import type { Env } from './config/env.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { MailModule } from './mail/mail.module.js';
import { UsageModule } from './ops/usage.module.js';
import { OpsModule, OutboxModule } from './ops/ops.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { PropertiesModule } from './properties/properties.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RolesModule } from './roles/roles.module.js';
import { WidgetModule } from './widget/widget.module.js';
import { TeamModule } from './team/team.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { Inject } from '@nestjs/common';
import { SecretBox } from './crypto/secret-box.js';
import { BotGuard, TurnstileService } from './security/turnstile.js';
import { Global } from '@nestjs/common';
import { LiveWhatsAppClient, MockWhatsAppClient, WHATSAPP_CLIENT } from './whatsapp/whatsapp.client.js';

@Global()
@Module({
  providers: [
    SecretBox, TurnstileService, BotGuard, AiTrigger, LiveWhatsAppClient, MockWhatsAppClient,
    { provide: WHATSAPP_CLIENT, inject: [ENV, LiveWhatsAppClient, MockWhatsAppClient], useFactory: (env: Env, live: LiveWhatsAppClient, mock: MockWhatsAppClient) => (env.WHATSAPP_MODE === 'live' ? live : mock) },
  ],
  exports: [SecretBox, TurnstileService, BotGuard, AiTrigger, WHATSAPP_CLIENT, MockWhatsAppClient],
})
class IntegrationsCoreModule {}

@Module({
  imports: [
    ConfigModule, ObservabilityModule, IntegrationsCoreModule, RealtimeModule, OutboxModule, EntitlementsModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      // Redis-backed so limits hold across API instances (tests keep the in-memory store: counters would otherwise leak between runs).
      useFactory: (env: Env) => ({ throttlers: [{ name: 'default', ttl: 60_000, limit: env.THROTTLE_GLOBAL_LIMIT }], ...(env.NODE_ENV === 'test' ? {} : { storage: new RedisThrottlerStorage(env.REDIS_URL, env.QUEUE_PREFIX) }) }),
    }),
    DbModule, MailModule, AuditModule, AuthModule, MfaModule, TenantsModule, LeadsModule, PipelineModule, PropertiesModule, CaptureModule, AnalyticsModule, ChannelsModule, ConversationsModule, WidgetModule, AiModule, OpsModule, BillingModule, PlatformModule, V1Module, WebhooksModule, ReportsModule, SupportModule, PrivacyModule, LifecycleModule, UsageModule, TeamModule, RolesModule, HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PlanGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(ENV) private readonly env: Env) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware, httpMetricsMiddleware, accessLogMiddleware(this.env.ACCESS_LOG ?? this.env.NODE_ENV === 'production'), cookieParser(), csrfOriginMiddleware([this.env.WEB_ORIGIN])).forRoutes('*path');
  }
}
