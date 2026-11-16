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
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1026),
  MAIL_FROM: z.string().default('LeadPilot <no-reply@leadpilot.local>'),
  ENABLE_SWAGGER: bool,
  /** Run the outbox relay, BullMQ workers and scanners in this process. The API process normally leaves this off and `apps/worker` turns it on. */
  WORKERS_ENABLED: bool,
  QUEUE_PREFIX: z.string().min(1).max(40).default('leadpilot'),
  AUTOMATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  AUTOMATION_RETRY_BASE_MS: z.coerce.number().int().min(10).default(2000),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.WHATSAPP_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['WHATSAPP_MODE'], message: 'mock mode is not allowed in production' });
    if (e.NODE_ENV === 'production' && e.VIRUS_SCAN_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['VIRUS_SCAN_MODE'], message: 'mock virus scanning is not allowed in production' });
    if (e.AI_PROVIDER === 'mock' && e.NODE_ENV === 'production') ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'the mock AI provider is not allowed in production' });
    if (e.AI_PROVIDER === 'openai' && !e.OPENAI_API_KEY) ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai' });
  }).safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}
