import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  REDIS_URL: z.string().url().default('redis://localhost:6380'),
  PUBLIC_API_URL: z.string().url().optional(),
  LOCAL_MASTER_KEY: z.string().min(40, 'LOCAL_MASTER_KEY must be base64 of 32 random bytes (openssl rand -base64 32)'),
  WHATSAPP_MODE: z.enum(['mock', 'live']).default('mock'),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1026),
  MAIL_FROM: z.string().default('LeadPilot <no-reply@leadpilot.local>'),
  ENABLE_SWAGGER: bool,
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.WHATSAPP_MODE === 'mock') ctx.addIssue({ code: 'custom', path: ['WHATSAPP_MODE'], message: 'mock mode is not allowed in production' });
  }).safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}
