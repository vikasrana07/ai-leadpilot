import { series } from '../common/series.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '../common/actor.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DbService } from '../db/db.module.js';
import { RealtimeService } from '../realtime/realtime.module.js';
import { AiTrigger, type InboundEvent } from './ai-trigger.js';
import { AssistantsService } from './assistants.service.js';
import { checkReply } from './guards.js';
import { KnowledgeService, type KnowledgeHit } from './knowledge/knowledge.service.js';
import { LLM_PROVIDER, LlmError, type ChatMessage, type LlmProvider } from './llm.js';
import { buildSystemPrompt, CANARY, PROMPT_VERSION } from './prompt.js';
import { modelTools, ToolRunner, type ToolContext } from './tools.js';
import type { WorkingHours } from './working-hours.js';

const MAX_ITERATIONS = 5;
const HISTORY = 20;

interface Trace { tools: { name: string; ok: boolean }[]; chunkIds: string[]; guard: { violations: string[] }; iterations: number; outcome: string; reply?: string; /** id of the newest customer message this run took into account (uuidv7 ids sort by arrival) */ answeredThrough?: string }

/**
 * One AI turn per conversation at a time. Flow: gate (kill switch, assistant on, AI mode, token cap) → keyword handover →
 * context (history, lead, retrieved knowledge) → model/tool loop → output guards (one corrective retry) → send → record the run.
 * Every outcome is persisted in `ai_runs` (tokens, latency, tools, guard decisions) without duplicating customer text.
 */
@Injectable()
export class AiOrchestrator implements OnModuleInit {
  private readonly log = new Logger('AI');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly active = new Set<string>();
  private readonly again = new Set<string>();
  private readonly inflight = new Set<Promise<void>>();
  debounceMs: number;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DbService) private readonly db: DbService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(ToolRunner) private readonly tools: ToolRunner,
    @Inject(AssistantsService) private readonly assistants: AssistantsService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(RealtimeService) private readonly rt: RealtimeService,
    @Inject(AiTrigger) private readonly trigger: AiTrigger,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) { this.debounceMs = Number(process.env.AI_DEBOUNCE_MS ?? 1200); }

  onModuleInit(): void { this.trigger.handler = (e) => this.enqueue(e); }

  /** Resolves when no turn is pending or running (tests, graceful shutdown). */
  async idle(): Promise<void> {
    for (let i = 0; i < 400 && (this.timers.size || this.inflight.size); i++) {
      if (this.inflight.size) await Promise.all([...this.inflight]); else await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Coalesces a burst of messages ("hi", "is 3bhk available", "budget 1cr") into one turn. */
  enqueue(e: InboundEvent): void {
    const prev = this.timers.get(e.conversationId); if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(e.conversationId);
      const p = this.runGuarded(e).finally(() => this.inflight.delete(p));
      this.inflight.add(p);
    }, this.debounceMs);
    this.timers.set(e.conversationId, t);
  }

  private async runGuarded(e: InboundEvent): Promise<void> {
    if (this.active.has(e.conversationId)) { this.again.add(e.conversationId); return; }
    this.active.add(e.conversationId);
    try { await this.turn(e); }
    catch (err) { this.log.error(`AI turn crashed for ${e.conversationId}: ${err instanceof Error ? err.message : String(err)}`); }
    finally {
      this.active.delete(e.conversationId);
      if (this.again.delete(e.conversationId)) this.enqueue(e);
    }
  }

  private machineActor(tenantId: string): Actor {
    return { tenantId, userId: null, membershipId: null, permissions: new Set(['conversation:read:all', 'lead:read:all']), requestId: undefined, ip: undefined };
  }

  private async turn(e: InboundEvent): Promise<void> {
    if (this.env.AI_KILL_SWITCH) return;
    const t = e.tenantId;
    // ---- 1. load everything needed, in one tenant-scoped read
    const ctx = await this.db.tenantTx({ tenantId: t }, async (tx) => {
      const [assistant, convo, tenant] = await series([ () => tx.aiAssistant.findUnique({ where: { tenantId: t } }), () => tx.conversation.findUnique({ where: { id: e.conversationId }, include: { channel: { select: { type: true } } } }), () => tx.tenant.findUniqueOrThrow({ where: { id: t } })]);
      if (!assistant?.enabled || !convo || convo.status !== 'OPEN' || convo.mode !== 'AI') return null;
      const [lead, recent, aiCount, prior] = await series([ () => tx.lead.findUniqueOrThrow({ where: { id: convo.leadId } }), () => tx.message.findMany({ where: { conversationId: convo.id, senderType: { not: 'SYSTEM' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY }), () => tx.message.count({ where: { conversationId: convo.id, senderType: 'AI' } }), () => tx.aiRun.findFirst({ where: { conversationId: convo.id, status: { in: ['COMPLETED', 'SKIPPED'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { trace: true } })]);
      return { assistant, convo, tenant, lead, messages: recent.reverse(), aiCount, answeredThrough: (prior?.trace as Trace | null)?.answeredThrough ?? null };
    });
    if (!ctx) return;
    const { assistant, convo, tenant, lead, messages } = ctx;

    // Only reply to messages nobody has answered yet. "Answered" is decided by what a previous run actually took into account
    // (a customer can write while we are still composing, so comparing timestamps with our own reply would lose that message).
    // A human reply also settles everything before it.
    const lastHuman = [...messages].reverse().find((m) => m.direction === 'OUTBOUND' && m.senderType === 'AGENT');
    const lastOut = [...messages].reverse().find((m) => m.direction === 'OUTBOUND');
    const pending = messages.filter((m) => m.direction === 'INBOUND' && (ctx.answeredThrough ? m.id > ctx.answeredThrough : !lastOut || m.createdAt > lastOut.createdAt) && (!lastHuman || m.createdAt > lastHuman.createdAt));
    if (pending.length === 0) return;
    const newestPending = pending.at(-1)?.id;
    const customerText = pending.map((m) => m.body ?? '').join('\n');

    // ---- 2. run record (the unique "one running per conversation" index is the cross-instance lock)
    const runId = uuidv7();
    const started = Date.now();
    try {
      await this.db.tenantTx({ tenantId: t }, async (tx) => {
        await tx.$executeRaw`UPDATE ai_runs SET status = 'FAILED', error = 'timed out', completed_at = now() WHERE conversation_id = ${e.conversationId}::uuid AND status = 'RUNNING' AND created_at < now() - interval '3 minutes'`;
        await tx.aiRun.create({ data: { id: runId, tenantId: t, conversationId: e.conversationId, triggerMessageId: e.messageId, promptVersion: PROMPT_VERSION } });
      });
    } catch (err) { if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { this.again.add(e.conversationId); return; } throw err; }

    const trace: Trace = { tools: [], chunkIds: [], guard: { violations: [] }, iterations: 0, outcome: 'pending' };
    let inTok = 0; let outTok = 0; let model: string = assistant.model ?? this.env.AI_CHAT_MODEL;
    const finish = async (status: 'COMPLETED' | 'FAILED' | 'SKIPPED', error?: string) => {
      if (status !== 'FAILED' && newestPending) trace.answeredThrough = newestPending;
      await this.db.tenantTx({ tenantId: t }, (tx) => tx.aiRun.update({ where: { id: runId }, data: { status, model, inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started, error: error ?? null, trace: trace as unknown as Prisma.InputJsonValue, completedAt: new Date() } }));
    };
    const toolCtx: ToolContext = {
      tenantId: t, conversationId: convo.id, leadId: lead.id, runId, allowed: new Set(assistant.allowedTools),
      assistant: { workingHours: (assistant.workingHours as unknown as WorkingHours) ?? null, name: assistant.name, businessIdentity: assistant.businessIdentity, businessDescription: assistant.businessDescription, languages: assistant.languages },
      tenant: { name: tenant.name, email: tenant.email, phone: tenant.phone, website: tenant.website, address: tenant.address, timezone: tenant.timezone, currency: tenant.currency },
    };
    const handover = async (reason: string, say?: string) => {
      const r = await this.tools.execute({ ...toolCtx, allowed: new Set(['handover_to_human']) }, 'handover_to_human', JSON.stringify({ reason }));
      trace.tools.push({ name: 'handover_to_human', ok: r.ok });
      if (say) await this.reply(t, convo.id, say, trace);
    };

    try {
      // ---- 3. cheap, deterministic gates BEFORE any model call
      // A lapsed workspace, or a plan without the AI assistant, never reaches the model: a person is asked to take over instead.
      const plan = await this.entitlements.get(t);
      if (plan.restricted || !plan.features.ai_assistant) { trace.outcome = 'plan_blocked'; await handover('The AI assistant is not available on the current plan'); await finish('SKIPPED', 'plan does not allow the AI assistant'); return; }
      const usage = await this.assistants.usage(t);
      if (usage.exceeded) { trace.outcome = 'token_cap_exceeded'; await handover('Monthly AI usage limit reached', assistant.fallbackMessage); await finish('SKIPPED', 'monthly token cap reached'); return; }
      const rules = (assistant.handoverRules as { keywords?: string[]; onNegotiation?: boolean; onComplaint?: boolean }) ?? {};
      const lower = customerText.toLowerCase();
      const hit = (rules.keywords ?? []).find((k) => lower.includes(k.toLowerCase()));
      if (hit) { trace.outcome = 'keyword_handover'; await handover(`Customer asked for a person ("${hit}")`, assistant.fallbackMessage.length ? this.handoverText(assistant, tenant.timezone) : undefined); await finish('COMPLETED'); return; }

      // ---- 4. context: retrieved knowledge (tenant-isolated) + prompt
      let hits: KnowledgeHit[] = [];
      try { hits = await this.knowledge.search(t, customerText.slice(-500), 4); } catch (err) { this.log.warn(`knowledge search failed: ${err instanceof Error ? err.message : String(err)}`); }
      trace.chunkIds = hits.map((h) => h.chunkId);
      const known: string[] = []; const missing: string[] = [];
      (lead.budgetMinMinor !== null || lead.budgetMaxMinor !== null ? known : missing).push(lead.budgetMinMinor !== null || lead.budgetMaxMinor !== null ? `budget ₹${Number(lead.budgetMinMinor ?? lead.budgetMaxMinor) / 100}${lead.budgetMaxMinor !== null && lead.budgetMinMinor !== null ? `–${Number(lead.budgetMaxMinor) / 100}` : ''}` : 'budget');
      (lead.location ? known : missing).push(lead.location ? `area ${lead.location}` : 'preferred area');
      (lead.buyingTimeline !== 'UNKNOWN' ? known : missing).push(lead.buyingTimeline !== 'UNKNOWN' ? `timeline ${lead.buyingTimeline}` : 'buying timeline');
      (lead.propertyType ? known : missing).push(lead.propertyType ? `looking for ${lead.propertyType}` : 'property type');
      const toolDefs = modelTools(toolCtx.allowed);
      const system = buildSystemPrompt({
        assistant: { ...assistant, workingHours: toolCtx.assistant.workingHours }, tenant: { name: tenant.name, timezone: tenant.timezone, industry: tenant.industry },
        lead: { name: lead.name, known, missing }, firstReply: ctx.aiCount === 0, nowIso: new Date().toISOString(), toolNames: toolDefs.map((d) => d.name),
      });
      // Unanswered customer messages go LAST even if our own reply was stored after them, so the model always sees what it must answer.
      const pendingIds = new Set(pending.map((m) => m.id));
      const ordered = [...messages.filter((m) => !pendingIds.has(m.id)), ...pending];
      const convoMsgs: ChatMessage[] = ordered.map((m): ChatMessage => m.direction === 'INBOUND'
        ? { role: 'user', content: `<customer_message id="${m.id.slice(-6)}" type="${m.type.toLowerCase()}">${(m.body ?? `[customer sent a ${m.type.toLowerCase()}]`).replaceAll('</customer_message>', '')}</customer_message>` }
        : { role: 'assistant', content: m.body ?? '' });
      if (hits.length) convoMsgs.push({ role: 'user', content: `<knowledge>\n${hits.map((h) => `[${h.title}] ${h.content.replaceAll('</knowledge>', '')}`).join('\n---\n')}\n</knowledge>\nUse the knowledge above only as reference facts for the customer's latest question.` });
      const history: ChatMessage[] = [{ role: 'system', content: system }, ...convoMsgs];
      const facts = [JSON.stringify({ lead: { known } }), tenant.name, tenant.website ?? '', tenant.phone ?? '', tenant.email, assistant.businessDescription, assistant.businessIdentity, ...hits.map((h) => h.content)];

      // ---- 5. model/tool loop
      let reply: string | null = null;
      for (let i = 0; i < MAX_ITERATIONS && reply === null; i++) {
        trace.iterations = i + 1;
        const r = await this.chatWithRetry({ model, messages: history, tools: toolDefs, temperature: assistant.temperature, maxTokens: 700 });
        inTok += r.usage.inputTokens; outTok += r.usage.outputTokens; model = r.model;
        if (r.toolCalls.length === 0) { reply = r.content ?? ''; break; }
        history.push({ role: 'assistant', content: r.content, toolCalls: r.toolCalls });
        for (const call of r.toolCalls.slice(0, 4)) {
          const out = await this.tools.execute(toolCtx, call.name, call.arguments);
          trace.tools.push({ name: call.name, ok: out.ok });
          const text = JSON.stringify(out.result);
          facts.push(text);
          history.push({ role: 'tool', toolCallId: call.id, name: call.name, content: text });
          if (call.name === 'handover_to_human' && out.ok) trace.outcome = 'model_handover';
        }
      }
      if (reply === null) { trace.outcome = 'iteration_limit'; await handover('The assistant could not finish the request', assistant.fallbackMessage); await finish('FAILED', 'iteration limit'); return; }

      // ---- 6. guards, with exactly one corrective retry
      let verdict = checkReply({ reply, facts: facts.join('\n'), canary: CANARY, maxChars: assistant.maxReplyChars });
      if (!verdict.ok) {
        trace.guard.violations.push(...verdict.violations);
        history.push({ role: 'assistant', content: reply }, { role: 'user', content: 'Your previous reply was rejected because it contained information that is not supported by the tool results or knowledge, or exposed internal details. Write a new reply that uses ONLY supported facts, or tell the customer a team member will confirm. Do not mention this message.' });
        const retry = await this.chatWithRetry({ model, messages: history, tools: [], temperature: 0, maxTokens: 400 });
        inTok += retry.usage.inputTokens; outTok += retry.usage.outputTokens;
        verdict = checkReply({ reply: retry.content ?? '', facts: facts.join('\n'), canary: CANARY, maxChars: assistant.maxReplyChars });
        if (!verdict.ok) { trace.guard.violations.push(...verdict.violations.map((v) => `retry:${v}`)); trace.outcome = 'guard_blocked'; await handover('The assistant could not answer safely', assistant.fallbackMessage); await finish('COMPLETED'); return; }
      }
      if (trace.outcome === 'pending') trace.outcome = 'replied';
      const disclosure = ctx.aiCount === 0 && assistant.disclosureText ? `${verdict.reply}\n\n${assistant.disclosureText}` : verdict.reply;
      await this.reply(t, convo.id, disclosure, trace);
      await finish('COMPLETED');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace.outcome = 'error';
      this.log.error(`AI run ${runId} failed: ${message}`);
      try { await handover('The assistant ran into a technical problem', assistant.fallbackMessage); } catch { /* best effort */ }
      await finish('FAILED', message.slice(0, 300)).catch(() => undefined);
    }
  }

  private handoverText(a: { name: string; fallbackMessage: string }, _tz: string): string { return a.fallbackMessage; }

  private async chatWithRetry(req: Parameters<LlmProvider['chat']>[0]) {
    try { return await this.llm.chat(req); }
    catch (e) { if (e instanceof LlmError && e.retryable) return this.llm.chat(req); throw e; }
  }

  /** Sends through the same channel rules as a human reply (24h window, opt-out). A blocked send is recorded, not retried. */
  private async reply(tenantId: string, conversationId: string, text: string, trace: Trace): Promise<void> {
    try { await this.conversations.sendAi(tenantId, conversationId, text); trace.reply = `${text.length} chars`; }
    catch (e) { trace.guard.violations.push(`send_blocked:${(e as { response?: { code?: string } }).response?.code ?? 'error'}`); if (trace.outcome === 'replied') trace.outcome = 'send_blocked'; }
  }
}
