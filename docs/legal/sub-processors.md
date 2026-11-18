# Sub-processors

> **DRAFT TEMPLATE: needs review by a qualified Indian lawyer before use.** Placeholders in {{DOUBLE_BRACES}} must be completed. Statements about what the product does reflect the code as of Phase 7 and must be re-checked before publication.

Status reflects the code as of Phase 7. **"Not yet live" means the integration is implemented but has not been used against the real provider**, or the provider is not chosen yet; do not publish a provider as active until it is.

| Sub-processor | Purpose | Data | Location | Status |
|---|---|---|---|---|
| OpenAI ({{OPENAI_ENTITY}}) | AI replies, extraction, embeddings (knowledge base) | Message text, lead fields needed for context, knowledge document text | {{OPENAI_REGION}} (likely outside India) | **Not yet live** (client written, never run against the real API; mock used in development) |
| Meta Platforms / WhatsApp Business Platform | WhatsApp messaging | Phone numbers, message content, templates | {{META_REGION}} | **Not yet live** (live client never run against Meta; each tenant connects its own WhatsApp Business account) |
| Razorpay ({{RAZORPAY_ENTITY}}) | Subscription payments | Billing contact, GSTIN, payment status (card/UPI data handled by Razorpay) | India | **Not yet live** (mock-verified only) |
| Amazon Web Services | Hosting: compute, managed Postgres, Redis, object storage | All service data | {{AWS_REGION}} (reference: ap-south-1) | Reference deployment, **not yet deployed** |
| Email delivery provider ({{EMAIL_PROVIDER_TBD}}) | Verification, invitations, billing notices | Email addresses, message text | {{EMAIL_REGION}} | **Provider not chosen** (SMTP interface; Mailpit in development) |
| Monitoring (built in; no separate provider) | Logs, metrics and alert emails | Structured logs with personal data redacted (ids only, no message content), numeric metrics, alert emails with numbers only | Stays with the hosting provider (CloudWatch, in the AWS region above) and the mail provider already listed for transactional email | **Built, not yet live** (no third-party error tracker such as Sentry is used; adding one would need a new row here and a transfer review) |

Change notice process: see DPA section 5.
