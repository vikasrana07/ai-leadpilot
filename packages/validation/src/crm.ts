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
/** `leads:create` is the original server-to-server capture scope (`POST /public/leads`); the rest are for the versioned public API (`/v1`). */
export const API_SCOPES = ['leads:create', 'leads:read', 'leads:write', 'leads:delete', 'conversations:read', 'appointments:read', 'appointments:write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length).default(['leads:create']),
  /** Optional lifetime in days (1 to 730). No value = the key does not expire. */
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

export const assignmentSettingsSchema = z.object({ strategy: z.enum(['manual', 'round_robin']) });

// --- analytics
export const analyticsQuerySchema = z.object({
  range: z.enum(['today', 'yesterday', '7d', '30d', 'month', 'custom']).default('30d'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// --- communication (phase 3)
export const channelWhatsappSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'The phone number ID is the long number from Meta, digits only'),
  wabaId: z.string().trim().regex(/^\d{6,25}$/, 'The WhatsApp Business Account ID is digits only'),
  accessToken: z.string().trim().min(20).max(1000),
  appSecret: z.string().trim().min(8).max(200),
});

/** What the browser sends after the Embedded Signup pop-up finishes: the one-time code plus the ids Meta reports. The server exchanges the code; the browser never sees a token. */
export const channelEmbeddedSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(5).max(2000),
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'The phone number ID is digits only'),
  wabaId: z.string().trim().regex(/^\d{6,25}$/, 'The WhatsApp Business Account ID is digits only'),
});

export const templateSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Template names use lowercase letters, numbers and underscores'),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Use a code like en or en_US').default('en'),
  category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']).default('UTILITY'),
  bodyPreview: z.string().trim().min(1).max(1024),
});

export const widgetConfigSchema = z.object({
  allowedOrigins: z.array(z.string().url().max(200)).min(1, 'Add at least one website address').max(10),
  enabled: z.boolean().default(true),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #3f55e8').default('#3f55e8'),
  position: z.enum(['right', 'left']).default('right'),
  title: z.string().trim().min(1).max(60).default('Chat with us'),
  greeting: z.string().trim().min(1).max(300).default('Hi! How can we help you today?'),
});

export const conversationListSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  mode: z.enum(['AI', 'HUMAN']).optional(),
  assigned: z.union([z.literal('me'), z.literal('unassigned'), z.string().uuid()]).optional(),
  channelType: z.enum(['WHATSAPP', 'WEB_WIDGET']).optional(),
  unread: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4096).optional(),
  template: z.object({ name: z.string().max(512), language: z.string().max(10), params: z.array(z.string().max(1024)).max(20).default([]) }).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
}).refine((v) => Boolean(v.text) !== Boolean(v.template), { message: 'Send either text or a template', path: ['text'] });

export const conversationAssignSchema = z.object({ assignedMembershipId: z.string().uuid().nullable() });
export const conversationTagsSchema = z.object({ tags: z.array(z.string().trim().min(1).max(30)).max(10) });

export const widgetSessionSchema = z.object({
  key: z.string().min(8).max(100),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
}).refine((v) => Boolean(v.phone) || Boolean(v.email), { message: 'Share a phone number or an email so we can follow up', path: ['phone'] });
export const widgetMessageSchema = z.object({ text: z.string().trim().min(1).max(2000) });

// --- AI (phase 4)
export const AI_TOOLS = ['get_business_info', 'search_properties', 'get_lead_details', 'update_lead', 'calculate_lead_score', 'check_availability', 'create_appointment', 'assign_agent', 'create_followup', 'handover_to_human'] as const;
/** Tools that exist but cannot be switched on yet. Empty since phase 5 shipped appointments. */
export const UNAVAILABLE_AI_TOOLS: readonly (typeof AI_TOOLS)[number][] = [];
export const AI_LANGUAGES = ['en', 'hi', 'hinglish'] as const;
export const AI_TONES = ['friendly', 'professional', 'concise', 'warm'] as const;

const dayHours = z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).nullable();
export const assistantSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(40),
  businessIdentity: z.string().trim().max(300),
  businessDescription: z.string().trim().max(2000),
  languages: z.array(z.enum(AI_LANGUAGES)).min(1).max(3),
  tone: z.enum(AI_TONES),
  welcomeMessage: z.string().trim().max(500),
  systemInstructions: z.string().trim().max(4000),
  workingHours: z.object({ enabled: z.boolean(), days: z.object({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours }) }),
  handoverRules: z.object({ keywords: z.array(z.string().trim().min(2).max(40)).max(30), onNegotiation: z.boolean(), onComplaint: z.boolean() }),
  allowedTools: z.array(z.enum(AI_TOOLS)).max(10).refine((t) => !t.some((x) => UNAVAILABLE_AI_TOOLS.includes(x)), { message: 'That tool is not available yet' }),
  model: z.string().trim().max(60).nullable(),
  temperature: z.number().min(0).max(1),
  maxReplyChars: z.number().int().min(100).max(1500),
  fallbackMessage: z.string().trim().min(1).max(500),
  disclosureText: z.string().trim().max(200),
  monthlyTokenCap: z.number().int().min(10_000).max(100_000_000).nullable(),
});
export type AssistantInput = z.infer<typeof assistantSchema>;

export const knowledgeSearchSchema = z.object({ q: z.string().trim().min(2).max(500), limit: z.number().int().min(1).max(10).default(5) });
export const documentUpdateSchema = z.object({ title: z.string().trim().min(1).max(160).optional(), category: z.string().trim().max(60).nullable().optional() });
