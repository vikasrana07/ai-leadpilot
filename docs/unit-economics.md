# Unit economics (Phase 0 draft)

**Status: model only. No figure below is a verified vendor price.** Every input marked `VERIFY` must be replaced with current published pricing (OpenAI, Meta WhatsApp Business Platform for India, AWS) before quotas are finalised in Phase 4/6. Plan prices are from the brief: Starter ₹4,999, Growth ₹9,999, Premium ₹14,999 per month (ex-GST).

## Purpose
Derive per-plan quotas (AI tokens, WhatsApp messages, storage) so that gross margin stays positive even for heavy tenants, and so hard caps (ADR/Part A "Usage tracking") have defensible values.

## Cost drivers per tenant per month

| Driver | Formula | Input | Source |
|---|---|---|---|
| LLM | conversations × turns × (in_tokens × p_in + out_tokens × p_out) | prices per 1M tokens | `VERIFY` OpenAI pricing for the chosen default model |
| Embeddings | chunks × tokens × p_embed (one-off per document) | | `VERIFY` |
| WhatsApp | template/marketing/utility/service message counts × per-message rate | India rate card | `VERIFY` Meta pricing. Meta fees may be billed to the tenant's own WABA payment method rather than to us; **decision needed** (see PROGRESS.md) |
| Infra | (fixed platform cost) ÷ active tenants + variable DB/storage/egress | | `VERIFY` AWS estimate from Phase 7 deployment sizing |
| Payments | Razorpay fee % × plan price | | `VERIFY` |
| Support | assumed time per tenant | | business decision |

## Parametric scenario (template, fill in later)

Variables: `C` AI conversations/month, `T` AI turns per conversation, `Ti` input tokens/turn (system prompt + history + retrieved context), `To` output tokens/turn.

- Monthly LLM cost = `C × T × (Ti × p_in + To × p_out)`
- Because input tokens dominate (history and retrieved chunks are resent each turn), design levers are: prompt caching, short rolling history with a stored summary, capped retrieved chunks, and a small/cheap model for classification and extraction.

Illustrative sizing to be filled once prices are verified: a Starter tenant at 300 conversations × 6 turns × ~3,000 input / ~250 output tokens ≈ 5.4M input and 0.45M output tokens a month. Multiply by verified prices to get the cost; compare to ₹4,999 less GST, payment fees and WhatsApp pass-through.

## Quota design (proposal, values pending verification)
- Quotas are per plan and stored in `plan_entitlements` (configurable by platform admins).
- Soft alert at 80%, hard stop at 100% for AI: the assistant sends the fallback message and hands over to a human, instead of continuing to spend.
- A per-tenant monthly AI spend ceiling in ₹ equivalent as a second safety net, independent of conversation counts.
- Overage: either block, or sell add-on packs [V1.1 decision].

## Open questions
1. ~~Do tenants pay Meta directly?~~ **Decided 2026-11-16: yes, tenants pay Meta on their own WABA.** WhatsApp fees are therefore not a LeadPilot cost; the WhatsApp row in the cost table drops out. The quota for WhatsApp becomes a fair-use/abuse limit and a usage display, not a cost control. Tenants must have a payment method on their WABA, which the setup guide and onboarding step 5 must explain.
2. Is a free trial offered, and with what AI/WhatsApp allowance?
3. Target gross margin per plan?

## Phase 6: quotas actually seeded (2026-11-16) — still unverified against vendor prices
| | Starter ₹4,999 | Growth ₹9,999 | Premium ₹14,999 |
|---|---|---|---|
| Seats | 3 | 10 | 30 |
| AI tokens / month | 1,000,000 | 3,000,000 | 8,000,000 |
| WhatsApp messages sent / month (fair use; tenants pay Meta) | 3,000 | 10,000 | 30,000 |
| Active automations | 3 | 8 | unlimited |
| Knowledge storage | 100 MB | 500 MB | 2,000 MB |
| CSV export | no | yes | yes |
These are **placeholders chosen for plausibility, not derived from verified costs**: replace them with numbers from real OpenAI pricing and observed tokens per conversation (the console edits them without a deploy). A 1M-token Starter allowance is roughly 300 conversations at the illustrative size above.
