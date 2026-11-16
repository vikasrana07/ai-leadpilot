import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

// ---------------------------------------------------------------------------------------------------------------------
// Provider-agnostic types. The orchestrator only ever talks to these interfaces (configurable provider abstraction).
// ---------------------------------------------------------------------------------------------------------------------
export interface ToolCall { id: string; name: string; arguments: string }
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface LlmRequest { model: string; messages: ChatMessage[]; tools: ToolDefinition[]; temperature: number; maxTokens: number }
export interface LlmResponse { content: string | null; toolCalls: ToolCall[]; usage: { inputTokens: number; outputTokens: number }; model: string }

export class LlmError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) { super(message); }
}

export interface LlmProvider { chat(req: LlmRequest): Promise<LlmResponse> }
export interface EmbeddingProvider { readonly model: string; readonly dimensions: number; embed(texts: string[]): Promise<number[][]> }
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
export const EMBEDDING_DIMENSIONS = 1536;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Real OpenAI client (Chat Completions with strict function tools + Embeddings). NOT yet verified against the live API:
 * no key was available when this was written; request/response shapes follow OpenAI's public documentation.
 */
@Injectable()
export class OpenAiLlm implements LlmProvider, EmbeddingProvider {
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly key: string;
  constructor(@Inject(ENV) env: Env) { this.key = env.OPENAI_API_KEY ?? ''; this.model = env.AI_EMBEDDING_MODEL; }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let lastErr: LlmError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://api.openai.com${path}`, { method: 'POST', headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
        if (res.ok) return (await res.json()) as T;
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new LlmError(`OpenAI error ${res.status}`, retryable, res.status);
        if (!retryable) break;
      } catch (e) { lastErr = new LlmError(`OpenAI unreachable: ${e instanceof Error ? e.message : 'unknown'}`, true); }
      await sleep(500 * 2 ** attempt);
    }
    throw lastErr ?? new LlmError('OpenAI request failed', true);
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const r = await this.post<{ model: string; choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]; usage?: { prompt_tokens: number; completion_tokens: number } }>('/v1/chat/completions', {
      model: req.model, temperature: req.temperature, max_tokens: req.maxTokens,
      messages: req.messages.map((m) => m.role === 'assistant' ? { role: 'assistant', content: m.content, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })) } : {}) } : m.role === 'tool' ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content } : m),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters, strict: true } })) } : {}),
    });
    const msg = r.choices[0]?.message;
    return { content: msg?.content ?? null, toolCalls: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })), usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 }, model: r.model };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const r = await this.post<{ data: { embedding: number[]; index: number }[] }>('/v1/embeddings', { model: this.model, input: texts.slice(i, i + 64) });
      out.push(...r.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Offline mock. Deterministic and rule-based: it is NOT a language model. It exists so the whole pipeline (tools, guards,
// scoring, handover, usage metering, UI) can run and be tested without network access or an API key.
// ---------------------------------------------------------------------------------------------------------------------
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'it', 'i', 'we', 'you', 'do', 'have', 'with', 'at', 'be', 'this', 'that', 'my', 'your', 'me', 'can', 'what', 'how']);

/** Hashing bag-of-words embedding: shared words give high cosine similarity, which is enough to test retrieval offline. */
@Injectable()
export class MockEmbeddings implements EmbeddingProvider {
  readonly model = 'mock-hash-1536';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  async embed(texts: string[]): Promise<number[][]> { return texts.map((t) => this.one(t)); }
  private one(text: string): number[] {
    const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const words = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
    for (const w of words) { let h = 2166136261; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); } v[(h >>> 0) % EMBEDDING_DIMENSIONS] = (v[(h >>> 0) % EMBEDDING_DIMENSIONS] ?? 0) + 1; }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

const est = (s: string) => Math.ceil(s.length / 4);
/** The customer's words since the assistant last replied (ignores the <knowledge> block and tool traffic). */
const lastUser = (m: ChatMessage[]): string => {
  const parts: string[] = [];
  for (let i = m.length - 1; i >= 0; i--) {
    const x = m[i];
    if (x?.role === 'assistant' && !x.toolCalls?.length) break;
    if (x?.role === 'user' && x.content.startsWith('<customer_message')) parts.unshift(x.content);
  }
  return parts.join('\n');
};

/** Pulls the customer's text out of the orchestrator's delimiter block. */
function customerText(raw: string): string { const m = raw.match(/<customer_message[^>]*>([\s\S]*?)<\/customer_message>/g); return m ? m.map((x) => x.replace(/<\/?customer_message[^>]*>/g, '')).join('\n').trim() : raw; }

export function parseBudget(t: string): { min?: number; max?: number } {
  const re = /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|k)?\b/gi;
  const found: number[] = [];
  for (const m of t.matchAll(re)) {
    const unit = (m[2] ?? '').toLowerCase();
    if (!unit) continue;
    const mult = unit.startsWith('cr') ? 1e7 : unit === 'k' ? 1e3 : 1e5;
    found.push(Math.round(Number(m[1]) * mult));
  }
  if (found.length === 0) return {};
  return found.length === 1 ? { max: found[0] as number } : { min: Math.min(...found), max: Math.max(...found) };
}

@Injectable()
export class MockLlm implements LlmProvider {
  /** Test hook: when set, the next call throws this (e.g. to exercise failure handling). */
  failNext: LlmError | null = null;
  calls = 0;

  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
    const inputTokens = est(req.messages.map((m) => ('content' in m ? m.content ?? '' : '')).join('\n'));
    const done = (content: string | null, toolCalls: ToolCall[] = []): LlmResponse => ({ content, toolCalls, usage: { inputTokens, outputTokens: est(content ?? JSON.stringify(toolCalls)) }, model: 'mock-assistant' });
    const has = (name: string) => req.tools.some((t) => t.name === name);
    const tc = (name: string, args: object): ToolCall => ({ id: `call_${name}_${this.calls}`, name, arguments: JSON.stringify(args) });

    // 1) Tool results are in: either continue the plan (save details, then look up inventory) or compose the final answer.
    const last = req.messages.at(-1);
    if (last?.role === 'tool') {
      const wants = /(bhk|\bavailable\b|\bflats?\b|\bapartments?\b|\bprice\b|\bcost\b|\boptions\b|\bpropert(y|ies)\b|\bunits?\b)/.test(customerText(lastUser(req.messages)).toLowerCase());
      const earlierTool = (n: string) => req.messages.some((m) => m.role === 'assistant' && m.toolCalls?.some((t) => t.name === n));
      if (last.name === 'update_lead' && wants && req.tools.some((t) => t.name === 'search_properties') && !earlierTool('search_properties')) {
        const t0 = customerText(lastUser(req.messages)); const bh = t0.toLowerCase().match(/(\d)\s*-?\s*bhk/); const b0 = parseBudget(t0); const l0 = t0.match(/\b(?:in|near|around|at)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/);
        return done(null, [{ id: `call_search_${this.calls}`, name: 'search_properties', arguments: JSON.stringify({ location: l0?.[1] ?? null, bedrooms: bh ? Number(bh[1]) : null, minPrice: null, maxPrice: b0.max ?? null, propertyType: null }) }]);
      }
      const wantsVisit = /\b(visit|book|appointment|schedule|see the (flat|house|property)|come over)\b/.test(customerText(lastUser(req.messages)).toLowerCase());
      if (last.name === 'update_lead' && wantsVisit && has('check_availability') && !earlierTool('check_availability')) return done(null, [tc('check_availability', { date: this.dateFor(req.messages, customerText(lastUser(req.messages))), durationMinutes: null })]);
      return done(this.answerFromTools(req.messages));
    }

    const text = customerText(lastUser(req.messages));
    const lower = text.toLowerCase();
    const earlier = (n: string) => req.messages.some((m) => m.role === 'assistant' && m.toolCalls?.some((t) => t.name === n));

    // Scheduling: choosing one of the times offered earlier books it; asking for a visit looks up real availability first.
    const pick = text.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
    if (pick && has('create_appointment') && !earlier('create_appointment')) {
      let h = Number(pick[1]); const pm = (pick[3] as string).toLowerCase() === 'pm'; if (h === 12) h = 0; if (pm) h += 12;
      const want = `${String(h).padStart(2, '0')}:${pick[2] ?? '00'}`;
      const offered = [...req.messages.filter((m) => m.role === 'assistant').map((m) => ('content' in m ? m.content ?? '' : '')).join('\n').matchAll(/(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}) (AM|PM)/g)];
      const hit = offered.map((o) => { let hh = Number((o[2] as string).split(':')[0]); const mm = (o[2] as string).split(':')[1]; if (hh === 12) hh = 0; if ((o[3] as string) === 'PM') hh += 12; return { date: o[1] as string, time: `${String(hh).padStart(2, '0')}:${mm}` }; }).find((o) => o.time === want);
      if (hit) return done(null, [tc('create_appointment', { date: hit.date, time: hit.time, notes: null })]);
    }
    if (/\b(human|agent|person|representative|manager|call me|talk to (someone|somebody)|insaan)\b/.test(lower) && has('handover_to_human') && !earlier('handover_to_human')) return done(null, [tc('handover_to_human', { reason: 'Customer asked to speak to a person' })]);
    if (/\b(discount|negotiat|best price|lower the price|refund|legal|complain)/.test(lower) && has('handover_to_human') && !earlier('handover_to_human')) return done(null, [tc('handover_to_human', { reason: 'Pricing, negotiation or complaint needs a person' })]);

    const facts: Record<string, unknown> = { budgetMin: null, budgetMax: null, location: null, propertyType: null, requirements: null, buyingTimeline: null, siteVisitRequested: null, name: null };
    const b = parseBudget(text); if (b.max !== undefined) { facts.budgetMax = b.max; if (b.min !== undefined) facts.budgetMin = b.min; }
    const bhk = lower.match(/(\d)\s*-?\s*bhk/); if (bhk) facts.propertyType = `${bhk[1]} BHK apartment`;
    const loc = text.match(/\b(?:in|near|around|at)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/); if (loc?.[1] && !/^(The|I|We|My)$/.test(loc[1])) facts.location = loc[1];
    if (/\b(immediately|asap|right away|this month|within (a )?month|30 days)\b/.test(lower)) facts.buyingTimeline = 'WITHIN_30_DAYS';
    else if (/\b(1|2|3|one|two|three)\s*(-|to)?\s*(3|three)?\s*months?\b/.test(lower)) facts.buyingTimeline = 'ONE_TO_THREE_MONTHS';
    if (/\b(visit|see the (flat|house|property)|site visit|come over)\b/.test(lower)) facts.siteVisitRequested = true;
    if (Object.values(facts).some((v) => v !== null) && has('update_lead') && !earlier('update_lead')) return done(null, [tc('update_lead', facts)]);
    if (/\b(visit|book|appointment|schedule|come over)\b/.test(lower) && has('check_availability') && !earlier('check_availability')) return done(null, [tc('check_availability', { date: this.dateFor(req.messages, text), durationMinutes: null })]);

    if (/(bhk|\bavailable\b|\bflats?\b|\bapartments?\b|\bprice\b|\bcost\b|\boptions\b|\bpropert(y|ies)\b|\bunits?\b)/.test(lower) && has('search_properties') && !earlier('search_properties')) {
      return done(null, [tc('search_properties', { location: (facts.location as string | null) ?? null, bedrooms: bhk ? Number(bhk[1]) : null, minPrice: null, maxPrice: (facts.budgetMax as number | null) ?? null, propertyType: null })]);
    }
    if (/\b(hi|hello|hey|namaste|hii)\b/.test(lower) && text.length < 40) return done('Hello! Thanks for reaching out. Are you looking to buy, and which area do you have in mind?');
    return done(this.askNext(req.messages, text));
  }

  /** Mock date parsing: an explicit YYYY-MM-DD, "day after tomorrow", "today", otherwise tomorrow (relative to the prompt's current date). */
  private dateFor(messages: ChatMessage[], text: string): string {
    const sys = messages.find((m) => m.role === 'system');
    const today = (sys && 'content' in sys ? (sys.content ?? '') : '').match(/Current time: (\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10);
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (iso) return iso;
    const add = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const l = text.toLowerCase();
    return /day after tomorrow/.test(l) ? add(2) : /\btoday\b/.test(l) ? add(0) : add(1);
  }

  private askNext(messages: ChatMessage[], text: string): string {
    const blob = messages.map((m) => ('content' in m ? m.content ?? '' : '')).join(' ').toLowerCase();
    const kb = messages.find((m) => m.role === 'user' && m.content.startsWith('<knowledge>'));
    if (kb && kb.role === 'user' && /\b(\?|how|what|when|where|do you|brochure|policy|loan|payment|documents?)\b/i.test(text)) {
      const first = kb.content.replace(/<\/?knowledge>/g, '').split('---')[0]?.replace(/^\s*\[[^\]]*\]\s*/, '').trim();
      if (first && first.length > 20) return `${first.slice(0, 300)}${first.length > 300 ? '…' : ''}`;
    }
    if (!/budget|lakh|crore/.test(blob.replace(/\[known[\s\S]*?\]/, ''))) return 'Happy to help! What budget range are you considering?';
    return 'Thanks! Which area are you interested in, and when are you planning to buy?';
  }

  private answerFromTools(messages: ChatMessage[]): string {
    const results = messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool');
    const lastResult = results.at(-1);
    const h12 = (t: string) => { const [h, m] = t.split(':').map(Number) as [number, number]; return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
    let data: { slots?: { date: string; time: string }[]; booked?: boolean; when?: string; existing?: string; alternatives?: string[]; properties?: { title: string; price: number; priceDisplay: string; location: string; status: string }[]; handedOver?: boolean; message?: string; error?: string } = {};
    try { data = JSON.parse(lastResult?.content ?? '{}') as typeof data; } catch { /* keep empty */ }
    if (lastResult?.name === 'check_availability') {
      if (!data.slots?.length) return data.message ?? 'I could not find a free time right now; a team member will contact you to arrange the visit.';
      return `These times are free for a site visit: ${data.slots.slice(0, 3).map((s) => `${s.date} ${h12(s.time)}`).join(', ')}. Which one suits you?`;
    }
    if (lastResult?.name === 'create_appointment') {
      if (data.booked) return `Done! I have requested your site visit for ${data.when}. The team will confirm it shortly.`;
      if (data.error === 'already_booked') return `You already have a visit planned for ${data.existing}. A team member can change it if you need.`;
      return `Sorry, that time is no longer free.${data.alternatives?.length ? ` Other options: ${data.alternatives.join('; ')}.` : ''} Which would you prefer?`;
    }
    if (lastResult?.name === 'handover_to_human') return data.message ?? 'I have asked a team member to take over. They will reply shortly.';
    if (lastResult?.name === 'search_properties') {
      if (!data.properties?.length) return "I couldn't find a matching available property right now. Could you share your budget and preferred area so a team member can suggest options?";
      const top = data.properties.slice(0, 3).map((p) => `${p.title} in ${p.location} at ${p.priceDisplay}`).join('; ');
      return `Here are some available options: ${top}. Would you like to arrange a site visit?`;
    }
    if (lastResult?.name === 'update_lead') return 'Thanks, noted! What budget range and area are you considering?';
    return 'Thanks! A team member will follow up with more details.';
  }
}
