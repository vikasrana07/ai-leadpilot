import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { Public } from '../common/decorators.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { LeadsModule } from '../leads/leads.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { buildOpenApi } from './openapi.js';
import { V1Controller } from './v1.controller.js';

/** The API description is public (it documents the contract, exposes no data). */
@Public() @Controller('v1')
class V1DocsController {
  constructor(@Inject(ENV) private readonly env: Env) {}
  @Get('openapi.json') spec() { return buildOpenApi(this.env.PUBLIC_API_URL ?? `http://localhost:${this.env.API_PORT}`); }
}

@Module({ imports: [LeadsModule, ConversationsModule, OpsModule], controllers: [V1Controller, V1DocsController], providers: [ApiKeyGuard, IdempotencyInterceptor] })
export class V1Module {}
