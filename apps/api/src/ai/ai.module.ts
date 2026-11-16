import { RequireFeature } from '../common/billing-meta.js';
import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { assistantSchema, type AssistantInput } from '@leadpilot/validation';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { AssistantsService } from './assistants.service.js';
import { KnowledgeController } from './knowledge/knowledge.controller.js';
import { KnowledgeService } from './knowledge/knowledge.service.js';
import { OBJECT_STORAGE, S3Storage } from './knowledge/storage.js';
import { ClamAvScanner, MockScanner, VIRUS_SCANNER } from './knowledge/virus-scan.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER, MockEmbeddings, MockLlm, OpenAiLlm } from './llm.js';
import { AiOrchestrator } from './orchestrator.js';
import { ScoringModule } from './scoring/scoring.module.js';
import { overrideSchema, scoringRulesSchema, ScoringService } from './scoring/scoring.service.js';
import { DEFAULT_SCORING_RULES, type ScoringRules } from './scoring/scoring.js';
import { DbService } from '../db/db.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { ToolRunner } from './tools.js';
import type { z } from 'zod';

@Controller()
class AiController {
  constructor(
    @Inject(AssistantsService) private readonly assistants: AssistantsService,
    @Inject(ScoringService) private readonly scoring: ScoringService,
    @Inject(DbService) private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('ai/assistant') @RequireFeature('ai_assistant') @RequirePermissions('ai:configure') async assistant(@CurrentTenant() c: TenantRequestContext) {
    return { ...(await this.assistants.get(c)), provider: this.env.AI_PROVIDER, killSwitch: this.env.AI_KILL_SWITCH };
  }
  @Put('ai/assistant') @RequireFeature('ai_assistant') @RequirePermissions('ai:configure') save(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(assistantSchema)) b: AssistantInput) { return this.assistants.save(c, b); }
  @Get('ai/usage') @RequirePermissions('ai:configure') usage(@CurrentTenant() c: TenantRequestContext) { return this.assistants.usage(c.tenantId, c.userId); }
  @Get('ai/runs') @RequirePermissions('ai:configure') runs(@CurrentTenant() c: TenantRequestContext) { return this.assistants.runs(c); }

  @Get('scoring/rules') async rules(@CurrentTenant() c: TenantRequestContext) {
    const r = await this.db.tenantTx(c, (tx) => this.scoring.rulesFor(tx, c.tenantId));
    return { version: r.version, rules: r.rules, defaults: DEFAULT_SCORING_RULES };
  }
  @Put('scoring/rules') @RequirePermissions('ai:configure') saveRules(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(scoringRulesSchema)) b: ScoringRules) { return this.scoring.saveRules(actorFrom(c), b); }

  @Get('leads/:id/score') leadScore(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.scoring.view(actorFrom(c), id); }
  @Post('leads/:id/score/override') @HttpCode(200) override(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(overrideSchema)) b: z.infer<typeof overrideSchema>) { return this.scoring.override(actorFrom(c), id, b); }
  @Delete('leads/:id/score/override') @HttpCode(200) clear(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.scoring.clearOverride(actorFrom(c), id); }
}

@Module({
  imports: [OpsModule, ConversationsModule, PropertiesModule, ScoringModule],
  controllers: [AiController, KnowledgeController],
  providers: [
    AssistantsService, KnowledgeService, ToolRunner, AiOrchestrator, S3Storage, ClamAvScanner, MockScanner, OpenAiLlm, MockLlm, MockEmbeddings,
    { provide: OBJECT_STORAGE, useExisting: S3Storage },
    { provide: VIRUS_SCANNER, inject: [ENV, ClamAvScanner, MockScanner], useFactory: (env: Env, clam: ClamAvScanner, mock: MockScanner) => (env.VIRUS_SCAN_MODE === 'clamav' ? clam : mock) },
    { provide: LLM_PROVIDER, inject: [ENV, OpenAiLlm, MockLlm], useFactory: (env: Env, live: OpenAiLlm, mock: MockLlm) => (env.AI_PROVIDER === 'openai' ? live : mock) },
    { provide: EMBEDDING_PROVIDER, inject: [ENV, OpenAiLlm, MockEmbeddings], useFactory: (env: Env, live: OpenAiLlm, mock: MockEmbeddings) => (env.AI_PROVIDER === 'openai' ? live : mock) },
  ],
  exports: [AiOrchestrator, KnowledgeService, AssistantsService, MockLlm, MockScanner],
})
export class AiModule {}
