import { z } from 'zod';

export const TEMPERATURES = ['HOT', 'WARM', 'COLD', 'UNKNOWN'] as const;
export const TIMELINES = ['UNKNOWN', 'IMMEDIATE', 'WITHIN_30_DAYS', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_PLUS_MONTHS'] as const;
export const PROPERTY_STATUSES = ['AVAILABLE', 'HELD', 'SOLD'] as const;

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const money = z.number().nonnegative().max(1e12).nullish();

export const leadFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: optText(32),
  email: z.string().trim().toLowerCase().email().max(254).nullish().transform((v) => v || null),
  sourceKey: z.string().trim().max(60).optional(),
  temperature: z.enum(TEMPERATURES).optional(),
  budgetMin: money,
  budgetMax: money,
  location: optText(200),
  propertyType: optText(80),
  requirements: optText(4000),
  buyingTimeline: z.enum(TIMELINES).optional(),
  assignedMembershipId: z.string().uuid().nullish(),
  nextFollowUpAt: z.string().datetime().nullish(),
  customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const budgetOrder = (v: { budgetMin?: number | null | undefined; budgetMax?: number | null | undefined }) =>
  v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax;
const budgetIssue = { message: 'Minimum budget cannot exceed maximum', path: ['budgetMin'] };

export const createLeadSchema = leadFieldsSchema
  .extend({ allowDuplicate: z.boolean().optional() })
  .refine((v) => Boolean(v.phone) || Boolean(v.email), { message: 'Provide a phone number or an email', path: ['phone'] })
  .refine(budgetOrder, budgetIssue);
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = leadFieldsSchema.partial().refine(budgetOrder, budgetIssue);
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const leadListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  stageId: z.string().uuid().optional(),
  kind: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  temperature: z.enum(TEMPERATURES).optional(),
  assigned: z.union([z.literal('me'), z.literal('unassigned'), z.string().uuid()]).optional(),
  sourceId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'score', 'nextFollowUpAt']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const stageChangeSchema = z.object({
  stageId: z.string().uuid(),
  lostReasonId: z.string().uuid().optional(),
  lostNote: z.string().trim().max(500).optional(),
});
export type StageChangeInput = z.infer<typeof stageChangeSchema>;

export const bulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), ids: z.array(z.string().uuid()).min(1).max(200), assignedMembershipId: z.string().uuid().nullable() }),
  z.object({ action: z.literal('stage'), ids: z.array(z.string().uuid()).min(1).max(200), stageId: z.string().uuid(), lostReasonId: z.string().uuid().optional(), lostNote: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('tag'), ids: z.array(z.string().uuid()).min(1).max(200), add: z.array(z.string().trim().min(1).max(40)).max(10).default([]), remove: z.array(z.string().trim().min(1).max(40)).max(10).default([]) }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().uuid()).min(1).max(200) }),
]);
export type BulkInput = z.infer<typeof bulkSchema>;

export const noteSchema = z.object({ body: z.string().trim().min(1, 'Write something first').max(4000) });
export const tagsSchema = z.object({ names: z.array(z.string().trim().min(1).max(40)).max(20) });
export const mergeSchema = z.object({ sourceIds: z.array(z.string().uuid()).min(1).max(10) });
export const checkDuplicatesSchema = z.object({ phone: z.string().trim().max(32).nullish(), email: z.string().trim().max(254).nullish(), excludeId: z.string().uuid().optional() });

export const importSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().default(true),
  duplicateStrategy: z.enum(['skip', 'import']).default('skip'),
});
export type ImportInput = z.infer<typeof importSchema>;

// --- pipeline
export const stageUpdateSchema = z.object({ name: z.string().trim().min(1).max(60).optional(), qualifies: z.boolean().optional(), canCloseWon: z.boolean().optional() });
export const stageCreateSchema = z.object({ name: z.string().trim().min(1).max(60), qualifies: z.boolean().default(false), canCloseWon: z.boolean().default(false) });
export const stageReorderSchema = z.object({ ids: z.array(z.string().uuid()).min(2).max(30) });
export const lostReasonSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const lostReasonUpdateSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() });

// --- properties
export const propertySchema = z.object({
  project: z.string().trim().min(1).max(120),
  unitLabel: optText(40),
  title: z.string().trim().min(1).max(160),
  propertyType: z.string().trim().min(1).max(60),
  bedrooms: z.number().int().min(0).max(20).nullish(),
  areaSqft: z.number().int().min(1).max(1_000_000).nullish(),
  price: z.number().positive().max(1e12),
  location: z.string().trim().min(1).max(200),
  status: z.enum(PROPERTY_STATUSES).default('AVAILABLE'),
});
export type PropertyInput = z.infer<typeof propertySchema>;
export const propertyUpdateSchema = propertySchema.partial();
export const propertyListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  propertyType: z.string().trim().max(60).optional(),
  location: z.string().trim().max(100).optional(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const propertyImportSchema = z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(true) });

// --- capture / api keys
export const captureLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  message: z.string().trim().max(4000).optional(),
  source: z.string().trim().max(60).optional(),
  location: z.string().trim().max(200).optional(),
  budgetMin: z.number().nonnegative().max(1e12).optional(),
  budgetMax: z.number().nonnegative().max(1e12).optional(),
  propertyType: z.string().trim().max(80).optional(),
}).refine((v) => Boolean(v.phone) || Boolean(v.email), { message: 'Provide a phone number or an email', path: ['phone'] });
export type CaptureLeadInput = z.infer<typeof captureLeadSchema>;
export const apiKeyCreateSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const assignmentSettingsSchema = z.object({ strategy: z.enum(['manual', 'round_robin']) });

// --- analytics
export const analyticsQuerySchema = z.object({
  range: z.enum(['today', 'yesterday', '7d', '30d', 'month', 'custom']).default('30d'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
