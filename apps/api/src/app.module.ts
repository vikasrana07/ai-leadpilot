import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './common/config.module.js';
import { AllExceptionsFilter } from './common/http-exception.filter.js';
import { AuthGuard, PermissionsGuard, TenantGuard } from './common/guards.js';
import { csrfOriginMiddleware, requestIdMiddleware } from './common/middleware.js';
import { ENV } from './common/tokens.js';
import type { Env } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { RolesModule } from './roles/roles.module.js';
import { TeamModule } from './team/team.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { Inject } from '@nestjs/common';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      // NOTE: in-memory store. Phase 5 swaps in the Redis store so limits hold across API instances.
      useFactory: (env: Env) => [{ name: 'default', ttl: 60_000, limit: env.THROTTLE_GLOBAL_LIMIT }],
    }),
    DbModule, MailModule, AuditModule, AuthModule, TenantsModule, TeamModule, RolesModule, HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(ENV) private readonly env: Env) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware, cookieParser(), csrfOriginMiddleware([this.env.WEB_ORIGIN])).forRoutes('*path');
  }
}
