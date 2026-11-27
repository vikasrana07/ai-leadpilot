import { recordConsent } from '../campaigns/consent.js';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '../db/db.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { OutboxService } from '../ops/outbox.service.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';
import type { Actor } from '../common/actor.js';

export interface ExtractedLeadData {
  name: string;
  phone?: string | null;
  email?: string | null;
  location?: string | null;
  requirements?: string | null;
  customFields?: Record<string, string>;
  formId?: string;
  adId?: string;
  leadgenId?: string;
}

export function parseMetaLeadPayload(body: unknown): ExtractedLeadData {
  const b = (body ?? {}) as Record<string, unknown>;

  // 1. Direct structured format (tests, bridges, or enriched payloads)
  if (typeof b.name === 'string' || typeof b.full_name === 'string' || typeof b.phone === 'string' || typeof b.phone_number === 'string') {
    return {
      name: (b.name as string) ?? (b.full_name as string) ?? 'Meta Lead',
      phone: (b.phone as string) ?? (b.phone_number as string) ?? null,
      email: (b.email as string) ?? null,
      location: (b.location as string) ?? (b.city as string) ?? null,
      requirements: (b.requirements as string) ?? null,
      formId: (b.form_id as string) ?? undefined,
      adId: (b.ad_id as string) ?? undefined,
      leadgenId: (b.leadgen_id as string) ?? undefined,
    };
  }

  // 2. Field data array format (Meta Graph API field_data)
  if (Array.isArray(b.field_data)) {
    let name = 'Meta Lead';
    let phone: string | null = null;
    let email: string | null = null;
    let location: string | null = null;
    const notes: string[] = [];

    for (const item of b.field_data as Array<{ name?: string; values?: string[] }>) {
      const fieldName = (item.name ?? '').toLowerCase();
      const val = item.values?.[0] ?? '';
      if (!val) continue;

      if (fieldName.includes('name') || fieldName === 'full_name') {
        name = val;
      } else if (fieldName.includes('phone') || fieldName === 'phone_number') {
        phone = val;
      } else if (fieldName.includes('email')) {
        email = val;
      } else if (fieldName.includes('city') || fieldName.includes('location')) {
        location = val;
      } else {
        notes.push(`${item.name}: ${val}`);
      }
    }

    return {
      name,
      phone,
      email,
      location,
      requirements: notes.length > 0 ? notes.join('\n') : null,
      formId: (b.form_id as string) ?? undefined,
      adId: (b.ad_id as string) ?? undefined,
      leadgenId: (b.leadgen_id as string) ?? undefined,
    };
  }

  // 3. Webhook change notification wrapper
  if (Array.isArray(b.entry)) {
    const entry = (b.entry as Array<{ changes?: Array<{ value?: Record<string, unknown> }> }>)[0];
    const change = entry?.changes?.[0];
    const val = change?.value;
    if (val) {
      return {
        name: 'Meta Lead',
        leadgenId: typeof val.leadgen_id === 'string' ? val.leadgen_id : undefined,
        formId: typeof val.form_id === 'string' ? val.form_id : undefined,
        adId: typeof val.ad_id === 'string' ? val.ad_id : undefined,
      };
    }
  }

  return { name: 'Meta Lead' };
}

@Injectable()
export class MetaLeadAdsService {
  private readonly log = new Logger(MetaLeadAdsService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  private systemActor(tenantId: string): Actor {
    return {
      tenantId,
      userId: null,
      membershipId: null,
      permissions: new Set(['lead:write:all', 'lead:assign']),
      requestId: undefined,
      ip: undefined,
    };
  }

  /** Resolves tenant by explicit tenantId or by matching pageId with channel externalId/config */
  async resolveTenantId(explicitTenantId?: string, pageId?: string): Promise<string> {
    if (explicitTenantId) {
      const exists = await this.db.userTx(null, (tx) =>
        tx.tenant.findUnique({ where: { id: explicitTenantId }, select: { id: true } }),
      );
      if (exists) return exists.id;
    }

    if (pageId) {
      const channel = await this.db.userTx(null, (tx) =>
        tx.channel.findFirst({
          where: { externalId: pageId },
          select: { tenantId: true },
        }),
      );
      if (channel) return channel.tenantId;
    }

    throw new NotFoundException({
      code: 'tenant_not_found',
      message: 'Could not resolve workspace for this Meta Lead Ad event',
    });
  }

  /** Ingests a Meta Lead Ad, de-duplicates by phone/email, captures consent, and fires automations */
  async ingestLead(tenantId: string, data: ExtractedLeadData): Promise<{ id: string; duplicate: boolean }> {
    const phoneNorm = normalizePhone(data.phone);
    const emailNorm = normalizeEmail(data.email);

    return this.db.tenantTx({ tenantId }, async (tx) => {
      // 1. Check for duplicates
      const dupes = await this.leads.findDuplicates(tx, tenantId, phoneNorm?.norm ?? null, emailNorm);
      if (dupes[0]) {
        const leadId = dupes[0].id;
        await tx.leadActivity.create({
          data: {
            id: uuidv7(),
            tenantId,
            leadId,
            type: 'enquiry_received',
            data: {
              source: 'meta_ads',
              adId: data.adId,
              formId: data.formId,
              leadgenId: data.leadgenId,
            },
          },
        });
        this.log.log(`Meta Lead Ad matched existing lead ${leadId} in tenant ${tenantId}`);
        return { id: leadId, duplicate: true };
      }

      // 2. Create new lead with round-robin assignment
      const actor = this.systemActor(tenantId);
      const { lead } = await this.leads.createInTx(
        tx,
        actor,
        {
          name: data.name || 'Meta Ad Enquirer',
          phone: phoneNorm?.display ?? data.phone ?? null,
          email: data.email ?? null,
          location: data.location ?? null,
          propertyType: null,
          requirements: data.requirements ?? null,
          sourceKey: 'meta_ads',
        },
        { defaultSource: 'meta_ads' },
      );

      // 3. A Lead Ad form submission means the person asked to be contacted about this enquiry: SERVICE consent, with the form as evidence.
      //    It is not an opt-in to promotional broadcasts; a MARKETING opt-in needs its own checkbox or an attestation.
      await recordConsent(tx, {
        tenantId, leadId: lead.id, status: 'OPTED_IN', purpose: 'SERVICE', method: 'META_LEAD_AD', actorType: 'CUSTOMER', source: 'meta_lead_ad',
        evidence: { provider: 'meta_lead_ads' },
      });

      // 4. Emit lead.created event for automation triggers (e.g. instant welcome WhatsApp)
      await this.outbox.emit(tx, tenantId, 'lead.created', {
        leadId: lead.id,
        source: 'meta_ads',
        adId: data.adId,
        formId: data.formId,
      });

      this.log.log(`Meta Lead Ad created lead ${lead.id} with opt-in consent in tenant ${tenantId}`);
      return { id: lead.id, duplicate: false };
    });
  }
}
