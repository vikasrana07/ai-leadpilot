import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '../db/db.module.js';
import type { TenantRequestContext } from '../common/request-context.js';

export interface CannedResponseItem {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  category?: string;
  isSystem?: boolean;
}

const DEFAULT_SNIPPETS: CannedResponseItem[] = [
  {
    id: 'sys-pricing',
    shortcut: 'pricing',
    title: 'Pricing & Availability',
    body: 'Hello {{lead.name}}, our 2 BHK units start at ₹75 Lakhs and 3 BHK units start at ₹1.1 Crore. Would you like me to share the detailed floor plans and cost breakdown?',
    category: 'Sales',
    isSystem: true,
  },
  {
    id: 'sys-brochure',
    shortcut: 'brochure',
    title: 'Project Brochure',
    body: 'Hello {{lead.name}}, please find our latest project brochure and amenities deck here. Let me know if you have any questions or would like to arrange a site visit.',
    category: 'Sales',
    isSystem: true,
  },
  {
    id: 'sys-directions',
    shortcut: 'directions',
    title: 'Location & Directions',
    body: 'Our sales gallery is located at Baner Road, near the highway junction. Visiting hours are 10:00 AM to 7:00 PM every day. Would you like me to share the Google Maps pin?',
    category: 'Logistics',
    isSystem: true,
  },
  {
    id: 'sys-loan',
    shortcut: 'loan',
    title: 'Home Loan Assistance',
    body: 'We have pre-approved partnerships with HDFC, SBI, and ICICI Bank offering home loan interest rates starting at 8.4% with zero processing fees. Would you like our banking executive to assist you?',
    category: 'Finance',
    isSystem: true,
  },
  {
    id: 'sys-visit',
    shortcut: 'visit',
    title: 'Site Visit Invitation',
    body: 'Hello {{lead.name}}, we would love to show you around the sample flat. Which day this week would be convenient for you?',
    category: 'Appointment',
    isSystem: true,
  },
];

@Injectable()
export class CannedResponsesService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Lists all canned responses for a workspace: defaults + custom tenant overrides */
  async list(ctx: TenantRequestContext): Promise<CannedResponseItem[]> {
    return this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
      const settings = (t?.settings ?? {}) as { cannedResponses?: CannedResponseItem[] };
      const custom = settings.cannedResponses ?? [];
      return [...DEFAULT_SNIPPETS, ...custom];
    });
  }

  /** Adds or updates a custom canned response */
  async create(ctx: TenantRequestContext, input: { shortcut: string; title: string; body: string; category?: string }): Promise<CannedResponseItem> {
    const shortcutClean = input.shortcut.replace(/^\//, '').trim().toLowerCase();
    const item: CannedResponseItem = {
      id: uuidv7(),
      shortcut: shortcutClean,
      title: input.title.trim(),
      body: input.body.trim(),
      category: input.category?.trim() || 'Custom',
      isSystem: false,
    };

    await this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
      const settings = (t?.settings ?? {}) as Record<string, unknown>;
      const existing = ((settings.cannedResponses ?? []) as CannedResponseItem[]).filter(
        (x) => x.shortcut !== shortcutClean,
      );
      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: {
            ...settings,
            cannedResponses: [...existing, item],
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return item;
  }

  /** Removes a custom canned response */
  async delete(ctx: TenantRequestContext, id: string): Promise<void> {
    await this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
      const settings = (t?.settings ?? {}) as Record<string, unknown>;
      const existing = (settings.cannedResponses ?? []) as CannedResponseItem[];
      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: {
            ...settings,
            cannedResponses: existing.filter((x) => x.id !== id),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
