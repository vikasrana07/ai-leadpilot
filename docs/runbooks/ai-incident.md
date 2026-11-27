# AI incidents

> **Alert that points here:** `ai_failure_rate` (over 20% of at least 10 AI runs failed in 15 minutes). Check the provider status, then consider the kill switch below.

Controls that exist today: platform kill switch (`AI_KILL_SWITCH`), per-tenant monthly token cap (the lower of the owner's cap and the plan allowance; hard stop then hand-over), per-tenant assistant on/off, deterministic output guards (prices, links, phone numbers, times, prompt-leak canary), 5-iteration tool-loop limit, handover to a human.

## Kill switch (all tenants)
1. Set `AI_KILL_SWITCH=true` on **api** (the AI turn runs in the API process) and restart/redeploy. While on, AI turns return immediately: conversations are not answered by the AI and no model call is made. Humans still reply from the inbox.
2. Tell affected tenants (customers' messages will wait for a person).
3. To resume: set `false`, restart. Messages that arrived meanwhile are not auto-answered; the minute scanner re-triggers only unanswered customer messages between 90 seconds and 6 hours old, once.

## One tenant
Tenant owner or platform admin: turn the assistant off (AI Assistant > settings) or suspend the tenant. Switching a conversation to human mode (Take over) stops the AI for that thread.

## Cost runaway
```sql
-- Tokens by tenant this month
SELECT tenant_id, count(*) runs, sum(input_tokens + output_tokens) tokens
FROM ai_runs WHERE created_at >= date_trunc('month', now()) GROUP BY tenant_id ORDER BY tokens DESC LIMIT 20;
```
Compare with the plan limit (`plan_entitlements.ai_tokens_monthly`) and the tenant cap (`ai_assistants.monthly_token_cap`, default `AI_DEFAULT_MONTHLY_TOKEN_CAP`). The cap stops the model before the call. Past the cap there is a grace band (`AI_CAP_GRACE_PCT`, default 10%) that only conversations the AI replied in within the last 24h may use; new chats are handed to a person immediately, and everything is handed over beyond the grace limit (`apps/api/src/ai/token-cap.ts`). Set `AI_CAP_GRACE_PCT=0` for a strict hard stop. If a loop is suspected, kill switch first, then inspect `ai_runs.trace` (tools called, iterations) for the offending conversation.

## "The AI said something wrong" (price, availability, promise)
1. Find it: `SELECT * FROM ai_runs WHERE conversation_id='<id>' ORDER BY created_at;` (`trace` has tool calls, retrieved chunk ids, guard violations, outcome).
2. Was the fact in a tool result / knowledge chunk / business facts? If a **knowledge document** was wrong or poisoned, fix or delete it (Knowledge Base) and reprocess.
3. If a guard should have caught it, capture the exact reply as an eval case (`apps/api/test/eval`) and fix the guard.
4. Customer remediation is the tenant's call; hand the conversation to a human.

## Prompt-injection report
Treat as security (Sev 2, Sev 1 if another tenant's data was involved). Collect the conversation id and `ai_runs.trace`. Check the tool calls: tools only act on the conversation's own lead/tenant from server context. Check `audit_logs`/`ai_tool_executions` for anything unexpected. Add the payload to the injection corpus test and fix. Cross-tenant leakage would be a [breach](data-breach-dpdp.md).

## LLM provider outage
Orchestrator errors mark the `ai_run` FAILED and the conversation is handled by a person; nothing crashes. Check provider status, `ai_runs.error`. Optionally enable the kill switch to stop repeated failing calls. **The live OpenAI client has never run against the real API** (see threat model): first live incidents may reveal client bugs.
