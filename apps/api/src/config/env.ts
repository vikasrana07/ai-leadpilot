import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const boolTrue = z.enum(['true', 'false']).default('true').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  REDIS_URL: z.string().url().default('redis://localhost:6380'),
  PUBLIC_API_URL: z.string().url().optional(),
  /** Master key for envelope encryption: `local` (LOCAL_MASTER_KEY from the secret store) or `kms` (AWS KMS, KMS_KEY_ID). See ADR-0007. */
  KEY_PROVIDER: z.enum(['local', 'kms']).default('local'),
  KMS_KEY_ID: z.string().min(1).optional(),
  KMS_REGION: z.string().optional(),
  /** Production refuses the local key unless this is explicitly set (an accepted, documented risk). */
  ALLOW_LOCAL_KEY_IN_PRODUCTION: bool,
  LOCAL_MASTER_KEY: z.string().min(40, 'LOCAL_MASTER_KEY must be base64 of 32 random bytes (openssl rand -base64 32)'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('leadpilot-files'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolTrue,
  VIRUS_SCAN_MODE: z.enum(['clamav', 'mock']).default('mock'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  AI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  AI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AI_KILL_SWITCH: bool,
  AI_DEFAULT_MONTHLY_TOKEN_CAP: z.coerce.number().int().positive().default(2_000_000),
  WHATSAPP_MODE: z.enum(['mock', 'live']).default('mock'),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  /** WhatsApp Embedded Signup (ADR-0012): one LeadPilot-owned Meta app connects every tenant's WhatsApp account. off = disabled (default), mock = offline stand-in (never in production), live = real Meta (needs the four META_* values). */
  EMBEDDED_SIGNUP_MODE: z.enum(['off', 'mock', 'live']).default('off'),
  META_APP_ID: z.string().optional(),
  /** Platform secret: signs the platform webhook and is used in the code exchange. Never logged or returned. */
  META_APP_SECRET: z.string().optional(),
  META_ES_CONFIG_ID: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1026),
  /** Optional SMTP authentication (e.g. Amazon SES SMTP credentials). Port 465 uses implicit TLS; other ports upgrade with STARTTLS. */
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('LeadPilot <no-reply@leadpilot.local>'),
  ENABLE_SWAGGER: bool,
  /** Application log format: `json` (one object per line; default in production) or `pretty` (readable; default elsewhere). */
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  /** Minimum level written: verbose < debug < log < warn < error. */
  LOG_LEVEL: z.enum(['verbose', 'debug', 'log', 'warn', 'error']).default('log'),
  /** Emit CloudWatch Embedded Metric Format lines once a minute (milestone 2). Default: on in production, off elsewhere. */
  METRICS_EMF: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  /** How often the metrics are written as CloudWatch EMF lines (seconds). */
  METRICS_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  /** Evaluate the alert rules and email platform admins (milestone 3). */
  ALERTS_ENABLED: bool,
  /** Comma-separated recipients for alert emails; empty means every active platform admin. */
  ALERT_EMAIL_TO: z.string().optional(),
  /** Re-send a still-firing Sev 1-2 alert every this many hours. */
  ALERT_REPEAT_HOURS: z.coerce.number().positive().max(168).default(6),
  /** One JSON access-log line per request on stdout. Default: on in production, off elsewhere. */
  ACCESS_LOG: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Run the outbox relay, BullMQ workers and scanners in this process. The API process normally leaves this off and `apps/worker` turns it on. */
  WORKERS_ENABLED: bool,
  QUEUE_PREFIX: z.string().min(1).max(40).default('leadpilot'),
  AUTOMATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  AUTOMATION_RETRY_BASE_MS: z.coerce.number().int().min(10).default(2000),
  // ---- Billing (Phase 6). Razorpay runs in 'mock' mode locally; 'live' talks to api.razorpay.com (use test-mode keys first).
  RAZORPAY_MODE: z.enum(['mock', 'live']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** Plan assigned to new workspaces. `internal` = unmetered (self-hosted/dev). Set to e.g. `growth` to start every signup on a trial of that plan. */
  SIGNUP_PLAN: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/).default('internal'),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(7),
  /** Seller details printed on GST invoices. */
  SELLER_LEGAL_NAME: z.string().default('LeadPilot (set SELLER_LEGAL_NAME)'),
  SELLER_GSTIN: z.string().optional(),
  SELLER_STATE_CODE: z.string().regex(/^\d{2}$/).default('29'),
  SELLER_ADDRESS: z.string().default('Set SELLER_ADDRESS'),
  /** Service Accounting Code on invoices. Confirm the right code with your chartered accountant before going live. */
  INVOICE_SAC: z.string().regex(/^\d{4,8}$/).default('998314'),
  /** Platform console (separate from tenant auth). Unset = the console is disabled. */
  /** Platform admins without MFA are held at the Security page until they enrol (recommended for production). */
  PLATFORM_REQUIRE_MFA: bool,
  PLATFORM_JWT_SECRET: z.string().min(32).optional(),
  // ---- Data lifecycle (Phase 8). Platform-wide defaults and hard minimums for per-workspace retention settings.
  RETENTION_WEBHOOK_PAYLOAD_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_SOFT_DELETED_LEAD_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** Automation history: dry-run rows (one per test click), finished runs, and old unreferenced versions. Per-workspace overrides are accepted by the API. */
  RETENTION_AUTOMATION_DRY_RUN_DAYS: z.coerce.number().int().min(1).max(3650).default(7),
  RETENTION_AUTOMATION_RUN_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  RETENTION_AUTOMATION_VERSION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  /** No workspace may configure a retention period shorter than this (protects against accidental or malicious data loss). */
  RETENTION_MIN_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  DELETION_COOLING_OFF_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  EXPORT_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  /** Requests per minute allowed per public-API key. */
  API_KEY_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  /** Bot check on public endpoints (register, login, forgot-password, widget sessions). off | mock (dev/test: token "mock-pass") | live (Cloudflare Turnstile). */
  TURNSTILE_MODE: z.enum(['off', 'mock', 'live']).default('off'),
  TURNSTILE_SECRET: z.string().min(1).optional(),
  /** Public site key handed to the widget (the web app uses NEXT_PUBLIC_TURNSTILE_SITE_KEY). */
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  /** Production refuses TURNSTILE_MODE=off unless this is set (an accepted, documented risk). */
  TURNSTILE_ALLOW_OFF_IN_PRODUCTION: bool,
  /** Outbound webhooks. PRIVATE targets (loopback, RFC1918...) and plain http are refused unless this is on; it exists for local tests only and is rejected in production. */
  WEBHOOK_ALLOW_PRIVATE_TARGETS: bool,
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(12).default(6),
  WEBHOOK_BACKOFF_BASE_MS: z.coerce.number().int().min(1).default(30_000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(8000),
  /** Consecutive exhausted deliveries after which an endpoint is switched off (and owners notified). */
  WEBHOOK_DISABLE_AFTER: z.coerce.number().int().min(1).default(10),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.WHATSAPP_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['WHATSAPP_MODE'], message: 'mock mode is not allowed in production' });
    if (e.EMBEDDED_SIGNUP_MODE === 'live') for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_ES_CONFIG_ID', 'META_WEBHOOK_VERIFY_TOKEN'] as const) if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when EMBEDDED_SIGNUP_MODE=live` });
    if (e.EMBEDDED_SIGNUP_MODE === 'mock' && !e.META_APP_SECRET) ctx.addIssue({ code: 'custom', path: ['META_APP_SECRET'], message: 'META_APP_SECRET is required when EMBEDDED_SIGNUP_MODE=mock (it signs the test webhook)' });
    if (e.NODE_ENV === 'production' && e.EMBEDDED_SIGNUP_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['EMBEDDED_SIGNUP_MODE'], message: 'mock Embedded Signup is not allowed in production' });
    if (e.EMBEDDED_SIGNUP_MODE !== 'off' && e.WHATSAPP_MODE === 'live' !== (e.EMBEDDED_SIGNUP_MODE === 'live')) ctx.addIssue({ code: 'custom', path: ['EMBEDDED_SIGNUP_MODE'], message: 'EMBEDDED_SIGNUP_MODE and WHATSAPP_MODE must both be live or both be mock' });
    if (e.NODE_ENV === 'production' && e.VIRUS_SCAN_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['VIRUS_SCAN_MODE'], message: 'mock virus scanning is not allowed in production' });
    if (e.AI_PROVIDER === 'mock' && e.NODE_ENV === 'production') ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'the mock AI provider is not allowed in production' });
    if (e.KEY_PROVIDER === 'kms' && !e.KMS_KEY_ID) ctx.addIssue({ code: 'custom', path: ['KMS_KEY_ID'], message: 'KMS_KEY_ID is required when KEY_PROVIDER=kms' });
    if (e.NODE_ENV === 'production' && e.KEY_PROVIDER === 'local' && !e.ALLOW_LOCAL_KEY_IN_PRODUCTION) ctx.addIssue({ code: 'custom', path: ['KEY_PROVIDER'], message: 'KEY_PROVIDER=local is not allowed in production (use kms, or set ALLOW_LOCAL_KEY_IN_PRODUCTION=true to accept the risk)' });
    if (e.TURNSTILE_MODE === 'live' && (!e.TURNSTILE_SECRET || !e.TURNSTILE_SITE_KEY)) ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET'], message: 'TURNSTILE_SECRET and TURNSTILE_SITE_KEY are required when TURNSTILE_MODE=live' });
    if (e.NODE_ENV === 'production' && e.TURNSTILE_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['TURNSTILE_MODE'], message: 'the mock bot check is not allowed in production' });
    if (e.NODE_ENV === 'production' && e.TURNSTILE_MODE === 'off' && !e.TURNSTILE_ALLOW_OFF_IN_PRODUCTION) ctx.addIssue({ code: 'custom', path: ['TURNSTILE_MODE'], message: 'TURNSTILE_MODE=off is not allowed in production (use live, or set TURNSTILE_ALLOW_OFF_IN_PRODUCTION=true to accept the risk)' });
    if (e.NODE_ENV === 'production' && e.RAZORPAY_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['RAZORPAY_MODE'], message: 'the mock payment provider is not allowed in production' });
    if (e.RAZORPAY_MODE === 'live') for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when RAZORPAY_MODE=live` });
    if (e.NODE_ENV === 'production' && !e.SELLER_GSTIN) ctx.addIssue({ code: 'custom', path: ['SELLER_GSTIN'], message: 'SELLER_GSTIN is required in production (printed on invoices)' });
    if (e.NODE_ENV === 'production' && e.WEBHOOK_ALLOW_PRIVATE_TARGETS) ctx.addIssue({ code: 'custom', path: ['WEBHOOK_ALLOW_PRIVATE_TARGETS'], message: 'private webhook targets are not allowed in production' });
    if (!!e.SMTP_USER !== !!e.SMTP_PASS) ctx.addIssue({ code: 'custom', path: ['SMTP_PASS'], message: 'SMTP_USER and SMTP_PASS must be set together' });
    if (e.AI_PROVIDER === 'openai' && !e.OPENAI_API_KEY) ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai' });
  }).safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''))); // `KEY=` in a .env file means "unset"
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}
