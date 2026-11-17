# Personal-data breach response (DPDP-aligned)

> **DRAFT: needs review by a qualified Indian lawyer before use.** This is an operational outline, not legal advice. It does not state statutory deadlines or notification content requirements: obtain them from counsel and from the Digital Personal Data Protection Act, 2023 and its Rules as in force on the day of the incident. Fill `{{...}}` placeholders before launch.

## Roles (to be confirmed by counsel)
- Our tenants are typically the **Data Fiduciary** for their leads' and customers' personal data; LeadPilot ({{ENTITY_NAME}}) acts as their **Data Processor**. For our own users' and tenant-owner account data we are the Data Fiduciary. The role split decides who must notify whom; the DPA (`docs/legal/data-processing-agreement.md`) should require us to inform affected tenants without undue delay.
- Contacts: Incident lead {{INCIDENT_LEAD}}; Grievance/Data Protection contact {{GRIEVANCE_OFFICER_NAME_EMAIL}}; Legal counsel {{LEGAL_COUNSEL}}.

## 1. Detect
Signals: a tenant sees another tenant's data; unexpected `platform_audit_logs`/`audit_logs` entries; spike in `auth.login_failed`; leaked secret/key; backup or dump exposed; third-party (OpenAI, Meta, Razorpay, AWS) breach notice; security researcher report. Open an incident ([incident-response.md](incident-response.md)), Sev 1.

## 2. Contain (first hours)
- Rotate what may be exposed: `JWT_ACCESS_SECRET` (invalidates all tenant sessions), `PLATFORM_JWT_SECRET` (console), database passwords, `OPENAI_API_KEY`, Razorpay keys, S3 keys; provider tokens per tenant are envelope-encrypted but if the master key (`LOCAL_MASTER_KEY`) leaked, treat every stored WhatsApp token as exposed and have tenants rotate them in Meta.
- Suspend affected tenants from the console if needed; disable platform admins (`UPDATE platform_admins SET status='DISABLED' ...`); enable `AI_KILL_SWITCH` if AI is implicated.
- **Preserve evidence**: snapshot the database, export logs (API/worker with `requestId`), keep `audit_logs`, `platform_audit_logs`, `webhook_events`, `billing_events`, `ai_runs`. Do not delete anything.

## 3. Assess
- What data (leads' names/phones/emails, conversation text, documents, billing profile/GSTIN, credentials), whose (which tenants, how many data principals), how (cause), when (first/last access), is it still happening, was data actually accessed vs. exposed, was it encrypted/hashed (passwords are argon2id; tokens are stored as hashes; provider secrets are envelope-encrypted; message text and lead data are **not** encrypted at the application layer).
- Useful queries: tenant audit trail (`audit_logs`), login failures by IP, `ai_runs.trace` for exfiltration attempts, Postgres/ALB logs for the window.
- Cross-tenant exposure is evidence that row-level security or tenant derivation failed: treat as Sev 1 and add a regression test.

## 4. Notify (decisions for counsel, not for the incident lead alone)
- Whether and when the **Data Protection Board of India** must be informed, and what the notice must contain.
- Whether and when **affected Data Principals** must be informed. For tenant-owned data, the tenant (Data Fiduciary) normally decides and sends; we give them what they need, promptly and in writing.
- Any other regulators or contractual duties (e.g. CERT-In under the IT Act 2000 directions, payment partners, WhatsApp/Meta, enterprise customers). **Confirm timelines and applicability with counsel at the time.**
- Keep a notification log: who, when, channel, content.

## 5. Recover and learn
Fix root cause, add a regression test, rotate remaining credentials, restore service, post-incident review in writing (timeline, data affected, decisions, notifications made, actions). Update the threat model.

## What we can and cannot show today
Can: tenant audit log, platform audit log, request ids, webhook/billing event tables, AI run traces, row-level security and tests. Cannot yet: a per-record data-access log for reads, a data-principal erasure/export tool, retention jobs (webhook raw payloads and old data are not purged automatically), centralised log retention (needs a deployment; API and worker now write structured JSON logs with `requestId`, `tenantId` and `userId` and with personal data redacted, see `docs/monitoring.md`) and alerting (not built yet).
