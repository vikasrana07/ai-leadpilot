# Defensive Security Architecture & Vulnerability Audit: LeadPilot AI

## 1. Defensive Security Architecture Overview

LeadPilot AI employs a multi-tiered **defense-in-depth** security architecture engineered to withstand multi-tenant SaaS attack vectors, including tenant data cross-contamination, privilege escalation, server-side request forgery (SSRF), and malicious payload injection.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MULTI-LAYER DEFENSE ARCHITECTURE                     │
├────────────────────────────────────────────────────────────────────────┤
│ 1. EDGE / INGRESS   : Cloudflare Turnstile Bot Guard + Helmet Headers  │
│ 2. APPLICATION      : Zod Schema Validation + Safe-HTTP SSRF Guard     │
│ 3. ACCESS CONTROL   : Session Cache + TenantGuard + 32 RBAC Permissions│
│ 4. SECRETS AT REST  : AWS KMS / AES-256-GCM Envelope Encryption        │
│ 5. DATABASE TIER    : PostgreSQL Row-Level Security (app.tenant_id RLS)│
│ 6. UPLOAD PIPELINE  : ClamAV Daemon Scanning + S3 Tenant Isolation     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Security Findings & Risk Classification

### Summary of Vulnerabilities by Severity
- **Critical**: 0
- **High**: 2
- **Medium**: 4
- **Low / Informational**: 3

---

### Finding SEC-01 (High): Unverified Production Cryptographic Key Provider (AWS KMS)
- **Classification**: **High**
- **Location**: `apps/api/src/crypto/secret-box.ts` (`awsKmsClient`) & `.env.example`
- **Description**: The platform implements envelope encryption to protect tenant WhatsApp access tokens, Meta app secrets, and user MFA secrets. While local development uses a 32-byte master key (`LOCAL_MASTER_KEY`), production relies on AWS KMS (`KEY_PROVIDER=kms`). The AWS KMS client has been written using `@aws-sdk/client-kms`, but **has never been exercised against live AWS KMS infrastructure** in a deployed staging/production environment.
- **Risk**: If IAM execution roles, KMS CMK policies, or regional endpoints fail during initial production boot, the API will fail closed, preventing all WhatsApp message processing, credential storage, and two-factor authentication.
- **Remediation**:
  1. Deploy an automated smoke test verifying that `awsKmsClient.encrypt` and `awsKmsClient.decrypt` succeed against a staging AWS KMS key alias.
  2. Implement an automated startup readiness check in `apps/api/src/bootstrap.ts` that performs a probe wrap/unwrap cycle on boot before declaring the application ready (`GET /health/ready`).

---

### Finding SEC-02 (High): Missing Strict CSP Script Nonces on Next.js Frontend
- **Classification**: **High**
- **Location**: `apps/web/next.config.ts` & `apps/web/app/layout.tsx`
- **Description**: The Content Security Policy (CSP) currently allows `'unsafe-inline'` for `script-src` to accommodate Next.js inline bootstrap scripts and hydration state.
- **Risk**: If an attacker discovers an XSS vector in rich text rendering (e.g., inside the unified inbox chat pane or internal notes), `'unsafe-inline'` prevents the browser CSP from blocking unauthorized script execution.
- **Remediation**:
  1. Migrate Next.js 16 to utilize dynamic nonce-based CSP generation via Next.js middleware (`headers()`).
  2. Pass nonces to all `<script>` tags, stripping `'unsafe-inline'` completely from the production CSP header.

---

### Finding SEC-03 (Medium): Unauthenticated Public Lead Capture Endpoint Exposed to Potential Flooding
- **Classification**: **Medium**
- **Location**: `apps/api/src/capture/capture.module.ts` (`POST /public/leads`)
- **Description**: The public lead capture endpoint is designed for server-to-server webhook ingestion using an API key. While API keys are validated and rate-limited via Redis (120 req/min), browser-facing submissions via the website widget (`/widget.js`) communicate with this service.
- **Risk**: A malicious user scraping the public widget key from a client website could flood the tenant's workspace with fake leads, exhausting their monthly lead entitlement and polluting their pipeline.
- **Remediation**:
  1. Enforce Cloudflare Turnstile bot verification on website widget visitor session creation (`POST /widget/session`).
  2. Introduce IP-based anomaly detection that flags rapid lead creation bursts from identical subnets.

---

### Finding SEC-04 (Medium): Outbound Webhook SSRF DNS Re-binding Vulnerability
- **Classification**: **Medium**
- **Location**: `apps/api/src/common/safe-http.ts` (`safeFetch`)
- **Description**: Outbound customer webhooks (`POST /webhooks/endpoints`) validate destination URLs using `safeFetch`, which blocks private IPv4 ranges (RFC-1918 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopbacks (`127.0.0.1`), and AWS metadata (`169.254.169.254`). However, the DNS lookup is performed prior to the HTTP connection.
- **Risk**: An attacker configuring a malicious webhook endpoint could exploit **Time-of-Check to Time-of-Use (TOCTOU) DNS Re-binding**, where the hostname resolves to a public IP during the validation check, but resolves to `169.254.169.254` during the subsequent HTTP dispatch, potentially extracting AWS IAM instance credentials.
- **Remediation**:
  1. Enforce custom HTTP agent IP pinning: resolve the IP address once, validate it against the private blocklist, and open the TCP socket directly to the validated IP address while passing the original hostname in the HTTP `Host` header and TLS SNI.

---

### Finding SEC-05 (Medium): Lack of Granular Rate Limiting on Inbound Webhook Ingress
- **Classification**: **Medium**
- **Location**: `apps/api/src/conversations/whatsapp-webhook.controller.ts`
- **Description**: Webhooks from Meta arrive at `/webhooks/whatsapp/:key`. These endpoints verify HMAC-SHA256 signatures but bypass standard user rate limits to prevent dropping legitimate customer messages.
- **Risk**: A compromised or misconfigured Meta webhook subscription sending millions of requests could overwhelm API instances and saturate database connections.
- **Remediation**:
  1. Place AWS WAF rate-based rules in front of `/webhooks/*` restricting traffic to Meta’s published public IP ranges (Meta AS32934).
  2. Offload webhook intake directly to an edge buffer (e.g., AWS SQS or Cloudflare Queues) before touching the primary application database.

---

### Finding SEC-06 (Medium): Incomplete Erasure in Asynchronous Backups
- **Classification**: **Medium**
- **Location**: `apps/api/src/privacy/privacy.module.ts` (`POST /privacy/leads/:id/erase`)
- **Description**: In compliance with the Indian Digital Personal Data Protection (DPDP) Act, LeadPilot provides single-lead erasure via an audited `SECURITY DEFINER` function. While the database record and associated messages are securely scrubbed from live PostgreSQL tables, point-in-time recovery (PITR) backups on AWS RDS retain the personal data until the backup retention window expires (typically 30 days).
- **Risk**: Data subject erasure verification fails if backups are restored into non-production environments without re-running data scrubbing scripts.
- **Remediation**:
  1. Document backup retention policies explicitly in the Privacy Policy (`docs/legal/privacy-policy.md`).
  2. Implement an automated post-restore sanitization script in runbooks to scrub erased lead IDs upon database restoration into testing environments.

---

### Finding SEC-07 (Low): Role Definitions Visible to All Workspace Members
- **Classification**: **Low**
- **Location**: `apps/api/src/roles/roles.module.ts` (`GET /roles`)
- **Description**: Any authenticated member (including restricted Sales Agents) can call `GET /roles` and inspect the complete catalog of 32 permission keys assigned to managers and owners.
- **Impact**: Information disclosure of organizational permission naming schemes; no direct privilege escalation risk. Accepted as by design for front-end UI rendering.

---

### Finding SEC-08 (Low): Error Fingerprints Exposed in Client Envelopes
- **Classification**: **Low**
- **Location**: `apps/api/src/common/http-exception.filter.ts`
- **Description**: Internal 500 errors generate a stable SHA-256 error fingerprint and include `requestId` in the response envelope for client traceability.
- **Impact**: Does not leak SQL queries or stack traces; harmless for security. Helpful for operational debugging.

---

## 3. Security Architecture Verification Matrix

| Security Domain | Mechanism Implemented | Verification Method | Status |
|---|---|---|:---:|
| **Tenant Isolation** | PostgreSQL Row-Level Security on all tenant tables | Automated multi-tenant test suite (`tenancy.test.ts`) attempting cross-tenant reads/updates. | **VERIFIED** |
| **Password Security** | Argon2id hashing with unique salts | Password service unit tests (`auth.test.ts`). | **VERIFIED** |
| **Session Hijacking** | Secure, HttpOnly, SameSite cookies + refresh rotation | Replay attacks tested with revoked tokens (`auth.test.ts`). | **VERIFIED** |
| **SQL Injection** | Prisma ORM parameterization + parameterized raw queries | Audited with static analysis and security test suite. | **VERIFIED** |
| **CSRF Protection** | Custom `x-requested-with` / SameSite Lax cookies | Verified across all API mutation routes. | **VERIFIED** |
| **Anti-Virus Protection**| ClamAV daemon stream scanning on document uploads | Tested with mock and real ClamAV containers (`ai-api.test.ts`). | **VERIFIED** |
| **SSRF Defense** | Private IP blocklist on webhook and image downloads | 8 SSRF attack variants tested (`safe-http.test.ts`). | **VERIFIED** |
| **Secret Encryption** | AES-256-GCM envelope encryption with KMS fallback | Round-trip encryption and tamper tests (`kms-keys.test.ts`). | **VERIFIED (Local)** |
| **Bot Protection** | Cloudflare Turnstile token validation on auth routes | Verified with mock pass tokens (`bot-protection.test.ts`). | **VERIFIED (Mock)** |
