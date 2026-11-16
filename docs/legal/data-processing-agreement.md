# Data Processing Agreement (Customer = Data Fiduciary, LeadPilot = Data Processor)

> **DRAFT TEMPLATE: needs review by a qualified Indian lawyer before use.** Placeholders in {{DOUBLE_BRACES}} must be completed. Statements about what the product does reflect the code as of Phase 7 and must be re-checked before publication.

Between **{{CUSTOMER_LEGAL_NAME}}** ("Customer", Data Fiduciary) and **{{ENTITY_NAME}}** ("LeadPilot", Data Processor), forming part of the Terms of Service.

## 1. Subject matter and duration
Processing of personal data of the Customer's leads, contacts and users through the LeadPilot service for the term of the subscription and the data-return period.

## 2. Nature, purpose, data and data principals
- **Purpose:** lead and conversation management, messaging via WhatsApp/website chat, appointments, automations, AI-assisted replies, analytics.
- **Data:** names, phone numbers, emails, budgets/requirements, message content and media references, appointment details, consent records, uploaded knowledge documents.
- **Data principals:** Customer's prospects and customers; Customer's staff.

## 3. Processor obligations
LeadPilot will: (a) process only on the Customer's documented instructions (the Terms and the Customer's configuration of the service); (b) ensure persons processing the data are bound by confidentiality; (c) implement the security measures in Annex 1; (d) engage sub-processors only under written terms and per section 5; (e) assist the Customer in responding to Data Principal requests and in meeting its obligations; (f) delete or return personal data at the end of the term per section 8; (g) make available information reasonably necessary to demonstrate compliance and allow audits per section 9.

## 4. Customer obligations
Customer is responsible for notice and valid consent (including WhatsApp opt-in), the lawfulness of its instructions, the accuracy of data, configuring the AI assistant and its disclosure, and responding to Data Principals. {{CUSTOMER_OBLIGATIONS_ADDITIONS}}

## 5. Sub-processors
Authorised sub-processors are listed in `sub-processors.md`. LeadPilot will give {{SUBPROCESSOR_NOTICE_DAYS}} days' notice of additions; Customer may object on reasonable grounds.

## 6. Personal data breach
LeadPilot will notify the Customer without undue delay (target: {{BREACH_NOTICE_HOURS}} hours) after becoming aware of a breach affecting the Customer's personal data, with the information then available, and cooperate in the Customer's notifications to the Data Protection Board and Data Principals as the law requires.

## 7. International transfers
{{TRANSFER_TERMS}} (sub-processors that process outside India are marked in the list).

## 8. Return and deletion
On termination, data export is available for {{EXPORT_WINDOW}} days; then deletion within {{DELETION_DAYS}} days, except where retention is legally required. Backups expire on their normal cycle ({{BACKUP_RETENTION_DAYS}} days).

## 9. Audit
Once per {{AUDIT_FREQUENCY}} on {{AUDIT_NOTICE}} notice, subject to confidentiality; LeadPilot may satisfy requests with reports/summaries first.

## 10. Liability
Subject to the Terms of Service: {{DPA_LIABILITY}}.

## Annex 1: Security measures (as implemented; verify before signing)
- Tenant isolation: tenant derived from the authenticated membership; every query in a tenant-scoped transaction; PostgreSQL row-level security with a non-owner, non-superuser application role.
- Authentication: argon2id; lockout and rate limits; rotating refresh tokens with reuse detection; hashed single-use tokens; role-based access control enforced server-side.
- Secrets: provider credentials envelope-encrypted (AES-256-GCM, per-record data keys wrapped by a master key; a KMS-backed master key {{KMS_STATUS}}); never returned by the API.
- Data in transit: HTTPS {{TLS_STATEMENT}}. At rest: {{AT_REST_ENCRYPTION_STATEMENT}}.
- Files: type/size/signature checks, virus scanning (fail closed), tenant-prefixed storage keys.
- Messaging: webhook HMAC verification, replay/duplicate protection, opt-out and 24-hour window enforcement.
- AI: delimited untrusted input, tool allow-lists and strict schemas, output guards, token caps, platform kill switch.
- Audit logging of actions; separate platform-admin console with its own credentials and audit trail.
- Backups: {{BACKUP_STATEMENT}}. Incident response: documented runbooks.
