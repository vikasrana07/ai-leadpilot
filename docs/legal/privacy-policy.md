# Privacy Policy

> **DRAFT TEMPLATE: needs review by a qualified Indian lawyer before use.** Placeholders in {{DOUBLE_BRACES}} must be completed. Statements about what the product does reflect the code as of Phase 7 and must be re-checked before publication.

**Data Fiduciary for account and billing data:** {{ENTITY_NAME}}, {{REGISTERED_ADDRESS}}. **Grievance Officer / Data Protection contact:** {{GRIEVANCE_OFFICER_NAME}}, {{GRIEVANCE_OFFICER_EMAIL}}. **Effective:** {{EFFECTIVE_DATE}}.

Scope: this policy covers personal data of people who sign up for or use LeadPilot (Customers' Users). Personal data of a Customer's own leads and customers is processed on the Customer's instructions as a **Data Processor** (see the Data Processing Agreement); those individuals should read the Customer's privacy notice.

## 1. What we collect
- **Account data:** name, email, password (stored only as an argon2id hash), workspace and role.
- **Billing data:** business legal name, GSTIN, state, address; invoices and payment status. Card/UPI details are handled by our payment partner and are not stored by us.
- **Usage and security data:** audit logs of actions in a workspace, IP address and user agent for sessions, request logs, error logs.
- **Content processed for Customers:** leads, conversations (WhatsApp, website chat), appointments, uploaded knowledge documents, AI interaction records (including token usage and tool calls).

## 2. Why (purposes) and basis
To provide and secure the service, bill, support, prevent abuse, and meet legal obligations. Basis: {{LAWFUL_BASIS_PER_DPDP}} (consent / legitimate uses as permitted by the DPDP Act, 2023). Marketing: {{MARKETING_POLICY}}.

## 3. Who we share with (sub-processors)
See `sub-processors.md`: cloud hosting ({{HOSTING_PROVIDER}}), AI model provider (message and document text sent for AI replies and embeddings), Meta (WhatsApp Business Platform), payment partner (Razorpay), email delivery ({{EMAIL_PROVIDER}}), error monitoring if enabled ({{MONITORING_PROVIDER}}). We do not sell personal data.

## 4. Where data is stored
{{DATA_LOCATION}} (reference deployment region: ap-south-1, Mumbai; confirm). Transfers outside India occur to the extent sub-processors operate abroad (e.g. AI provider): {{CROSS_BORDER_STATEMENT}}.

## 5. Security
Tenant isolation enforced in the application and by PostgreSQL row-level security; non-privileged database role for the application; TLS in transit ({{TLS_STATEMENT}}); argon2id password hashing; hashed single-use tokens; refresh-token rotation with reuse detection; rate limiting and lockout; provider credentials envelope-encrypted; uploaded files virus-scanned; webhook signature verification; audit logging. No system is perfectly secure; see our breach response commitments in the DPA. Message text and lead data are **not** encrypted at the application layer beyond database/storage encryption provided by the host ({{AT_REST_ENCRYPTION_STATEMENT}}).

## 6. Retention and deletion
Account and workspace data are kept while the account is active and for {{RETENTION_AFTER_TERMINATION}} afterwards, then deleted or anonymised. Tax invoices are kept as required by law ({{INVOICE_RETENTION_YEARS}} years). Backups roll off in {{BACKUP_RETENTION_DAYS}} days. Raw provider webhook payloads and logs: {{LOG_RETENTION}}. **Note for drafters:** automated retention jobs and a self-service erasure/export workflow are not yet implemented; describe the manual process {{MANUAL_ERASURE_PROCESS}} or do not promise automation.

## 7. Your rights (Data Principal)
Access, correction, completion, erasure, grievance redressal, and nomination, as provided in the DPDP Act, 2023. Contact {{GRIEVANCE_OFFICER_EMAIL}}. If you are a lead of one of our Customers, contact that Customer first; we will assist them.

## 8. Children
The service is for businesses and is not directed at children. {{CHILDREN_STATEMENT}}

## 9. Cookies
We use cookies necessary for sign-in (httpOnly session cookies). {{ANALYTICS_COOKIES_STATEMENT}}

## 10. Changes and contact
{{CHANGE_NOTICE}} Contact: {{CONTACT_EMAIL}}.
