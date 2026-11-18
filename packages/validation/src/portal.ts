import { z } from 'zod';

/** Lead-facing customer portal (ADR 0013). */
export const PORTAL_KEY_REGEX = /^pp_[A-Za-z0-9_-]{10,60}$/;

/** A phone number or an email address, as typed by the customer. Format is checked by the server (normalisation), never confirmed to exist. */
export const portalCodeRequestSchema = z.object({ identity: z.string().trim().min(3).max(200) });
export const portalVerifySchema = z.object({ identity: z.string().trim().min(3).max(200), code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits') });

/** What staff can configure. */
export const portalConfigSchema = z.object({
  enabled: z.boolean(),
  allowConfirm: z.boolean().default(true),
  allowCancel: z.boolean().default(true),
  allowReschedule: z.boolean().default(true),
  cancelCutoffHours: z.number().int().min(0).max(168).default(4),
});
export type PortalConfigInput = z.infer<typeof portalConfigSchema>;
