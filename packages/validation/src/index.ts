import { z } from 'zod';

export const INDUSTRIES = ['real_estate', 'coaching', 'healthcare', 'home_services', 'other'] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const ASSIGNABLE_ROLE_KEYS = ['owner', 'manager', 'agent'] as const;

const email = z.string().trim().toLowerCase().email().max(254);

/** 10+ chars, upper + lower + digit. Length matters more than composition; this is a floor, not a ceiling. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password: passwordSchema,
  businessName: z.string().trim().min(2).max(120),
  industry: z.enum(INDUSTRIES).default('real_estate'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const switchWorkspaceSchema = z.object({ tenantId: z.string().uuid() });

export const roleKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Role key must have at least 2 characters')
  .max(32, 'Role key must have at most 32 characters')
  .regex(/^[a-z0-9_-]+$/, 'Role key may only contain lowercase letters, numbers, hyphens, and underscores');

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(2, 'Name must have at least 2 characters').max(64, 'Name must have at most 64 characters'),
  permissions: z.array(z.string()).min(1, 'Select at least one permission'),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2, 'Name must have at least 2 characters').max(64, 'Name must have at most 64 characters'),
  permissions: z.array(z.string()).min(1, 'Select at least one permission'),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const inviteSchema = z.object({ email, roleKey: roleKeySchema });
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  // Required only when the invited email has no account yet.
  name: z.string().trim().min(2).max(100).optional(),
  password: passwordSchema.optional(),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeRoleSchema = z.object({ roleKey: roleKeySchema });
export const changeMemberStatusSchema = z.object({ status: z.enum(['ACTIVE', 'DEACTIVATED']) });

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: email,
    phone: z.string().trim().max(32).nullable(),
    website: z.string().trim().url().max(300).nullable(),
    address: z.string().trim().max(500).nullable(),
    industry: z.enum(INDUSTRIES),
    timezone: z.string().trim().min(1).max(64),
    currency: z.string().trim().length(3).toUpperCase(),
  })
  .partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const ONBOARDING_STEPS = [
  'business', 'industry', 'team', 'whatsapp', 'assistant', 'knowledge', 'qualification', 'complete',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingProgressSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  /** Steps that were explicitly completed or skipped. */
  completed: z.array(z.enum(ONBOARDING_STEPS)).max(ONBOARDING_STEPS.length),
  skipped: z.array(z.enum(ONBOARDING_STEPS)).max(ONBOARDING_STEPS.length).default([]),
});
export type OnboardingProgress = z.infer<typeof onboardingProgressSchema>;

export const auditQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().max(100).optional(),
});

export * from './crm.js';
export * from './ops.js';
export * from './billing.js';
export * from './integrations.js';
export * from './automation-graph.js';
export * from './portal.js';
export * from './email-tracking.js';
