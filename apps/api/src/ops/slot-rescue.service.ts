import { consentDispositionById } from '../campaigns/consent.js';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DbService } from '../db/db.module.js';
import { AppointmentsService } from './appointments.service.js';
import { NotificationsService } from './notifications.service.js';

type AppointmentsSvc = AppointmentsService;

export interface SlotRescueSettings {
  enabled: boolean;
  maxCandidates: number;
  minTemperature: 'HOT' | 'WARM';
}

const DEFAULT_SETTINGS: SlotRescueSettings = {
  enabled: false,
  maxCandidates: 5,
  minTemperature: 'WARM',
};

interface PublicOfferRow {
  id: string;
  tenant_id: string;
  title: string;
  location: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
  offered_lead_ids: string[];
  expires_at: Date;
  business_name: string;
  timezone: string;
}

@Injectable()
export class SlotRescueService {
  private readonly log = new Logger('SlotRescue');

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(forwardRef(() => AppointmentsService)) private readonly appointments: AppointmentsSvc,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private parseSettings(raw: unknown): SlotRescueSettings {
    const s = (raw as { slotRescue?: Partial<SlotRescueSettings> } | null)?.slotRescue;
    return {
      enabled: s?.enabled ?? DEFAULT_SETTINGS.enabled,
      maxCandidates: Math.min(10, Math.max(1, Number(s?.maxCandidates ?? DEFAULT_SETTINGS.maxCandidates))),
      minTemperature: s?.minTemperature === 'HOT' ? 'HOT' : 'WARM',
    };
  }

  async getSettings(tenantId: string): Promise<SlotRescueSettings> {
    const t = await this.db.tenantTx({ tenantId }, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } }),
    );
    return this.parseSettings(t.settings);
  }

  async saveSettings(ctx: TenantRequestContext, input: SlotRescueSettings): Promise<SlotRescueSettings> {
    const clean: SlotRescueSettings = {
      enabled: Boolean(input.enabled),
      maxCandidates: Math.min(10, Math.max(1, input.maxCandidates)),
      minTemperature: input.minTemperature === 'HOT' ? 'HOT' : 'WARM',
    };
    await this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
      const prev = (t.settings as Record<string, unknown> | null) ?? {};
      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: { settings: { ...prev, slotRescue: clean } as object },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'slot_rescue.settings_updated',
        resourceType: 'tenant',
        resourceId: ctx.tenantId,
        metadata: { ...clean },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });
    });
    return clean;
  }

  async listOffers(tenantId: string) {
    return this.db.tenantTx({ tenantId }, (tx) =>
      tx.slotRescueOffer.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    );
  }

  async triggerForCancelledAppointment(tenantId: string, appointmentId: string): Promise<{ created: boolean; offeredCount: number }> {
    const res = await this.db.tenantTx({ tenantId }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
      const cfg = this.parseSettings(t?.settings);
      if (!cfg.enabled) return null;

      const appt = await tx.appointment.findFirst({ where: { id: appointmentId, tenantId } });
      if (!appt || appt.status !== 'CANCELLED') return null;

      // Require at least 2 hours lead time before slot starts
      const now = Date.now();
      if (appt.startsAt.getTime() - now < 2 * 3_600_000) return null;

      // Avoid duplicate rescue offer for the same cancelled appointment
      const existing = await tx.slotRescueOffer.findFirst({
        where: { tenantId, sourceAppointmentId: appt.id },
        select: { id: true },
      });
      if (existing) return null;

      const temps = cfg.minTemperature === 'HOT' ? (['HOT'] as const) : (['HOT', 'WARM'] as const);
      const recentCutoff = new Date(now - 48 * 3_600_000);
      const recentOffers = await tx.slotRescueOffer.findMany({
        where: { tenantId, createdAt: { gte: recentCutoff } },
        select: { offeredLeadIds: true },
      });
      const recentlyOffered = new Set(recentOffers.flatMap((o) => o.offeredLeadIds));

      const busyAppts = await tx.appointment.findMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startsAt: { lt: appt.endsAt },
          endsAt: { gt: appt.startsAt },
        },
        select: { leadId: true },
      });
      const excludedIds = [appt.leadId, ...busyAppts.map((b) => b.leadId)];

      const candidates = await tx.lead.findMany({
        where: {
          tenantId,
          deletedAt: null,
          mergedIntoId: null,
          id: { notIn: excludedIds },
          temperature: { in: [...temps] },
          stage: { kind: 'OPEN' },
        },
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        take: cfg.maxCandidates * 3,
        select: { id: true, name: true },
      });

      const selected = candidates.filter((c) => !recentlyOffered.has(c.id)).slice(0, cfg.maxCandidates);
      if (selected.length === 0) return null;

      const claimToken = `sr_${crypto.randomBytes(16).toString('base64url')}`;
      const expiresAt = new Date(Math.min(appt.startsAt.getTime() - 3_600_000, now + 4 * 3_600_000));
      const offer = await tx.slotRescueOffer.create({
        data: {
          tenantId,
          sourceAppointmentId: appt.id,
          membershipId: appt.membershipId,
          title: appt.title,
          location: appt.location,
          startsAt: appt.startsAt,
          endsAt: appt.endsAt,
          status: 'OPEN',
          claimToken,
          offeredLeadIds: selected.map((c) => c.id),
          expiresAt,
        },
      });

      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'slot_rescue.offer_created',
        resourceType: 'slot_rescue',
        resourceId: offer.id,
        metadata: { sourceAppointmentId: appt.id, offeredCount: selected.length },
      });

      return { offer, selected };
    });

    if (!res) return { created: false, offeredCount: 0 };

    // Best-effort WhatsApp template notification to opted-in candidates
    void this.dispatchOffers(tenantId, res.offer, res.selected.map((s) => s.id)).catch((e: unknown) =>
      this.log.warn(`Slot rescue dispatch error: ${e instanceof Error ? e.message : 'unknown'}`),
    );

    return { created: true, offeredCount: res.selected.length };
  }

  private async dispatchOffers(
    tenantId: string,
    offer: { id: string; claimToken: string; startsAt: Date; title: string },
    leadIds: string[],
  ): Promise<void> {
    const routes = await this.db.tenantTx({ tenantId }, async (tx) => {
      const tpl = await tx.whatsappTemplate.findFirst({
        where: { tenantId, name: 'slot_rescue_offer', OR: [{ approvalStatus: null }, { approvalStatus: 'APPROVED' }] },
        select: { language: true },
      });
      if (!tpl) return [];
      const out: { leadId: string; conversationId: string; language: string }[] = [];
      for (const leadId of leadIds) {
        const convo = await tx.conversation.findFirst({
          where: { tenantId, leadId, channel: { type: 'WHATSAPP', status: 'ACTIVE' } },
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true },
        });
        if (!convo) continue;
        if ((await consentDispositionById(tx, tenantId, leadId, 'SERVICE')) !== 'ELIGIBLE') continue;
        out.push({ leadId, conversationId: convo.id, language: tpl.language });
      }
      return out;
    });

    for (const r of routes) {
      const claimUrl = `${this.env.WEB_ORIGIN}/p/claim/${offer.claimToken}?l=${r.leadId}`;
      await this.conversations.sendSystem(tenantId, r.conversationId, {
        template: {
          name: 'slot_rescue_offer',
          language: r.language,
          params: [offer.title, offer.startsAt.toISOString(), claimUrl],
        },
        idempotencyKey: `slot-rescue:${offer.id}:${r.leadId}`,
      });
    }
  }

  async getPublicOffer(token: string) {
    const row = (
      await this.db.userTx(null, (tx) => tx.$queryRaw<PublicOfferRow[]>`SELECT * FROM find_slot_rescue_by_token(${token})`)
    )[0];
    if (!row) throw new NotFoundException({ code: 'not_found', message: 'This slot offer is no longer available' });
    const expired = new Date(row.expires_at).getTime() <= Date.now() || row.status !== 'OPEN';
    return {
      businessName: row.business_name,
      title: row.title,
      location: row.location,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      timezone: row.timezone,
      status: row.status,
      expired,
    };
  }

  async claimOffer(token: string, leadId: string) {
    if (!leadId) throw new BadRequestException({ code: 'lead_required', message: 'Missing guest link parameter' });
    const row = (
      await this.db.userTx(null, (tx) => tx.$queryRaw<PublicOfferRow[]>`SELECT * FROM find_slot_rescue_by_token(${token})`)
    )[0];
    if (!row) throw new NotFoundException({ code: 'not_found', message: 'This slot offer is no longer available' });
    if (!row.offered_lead_ids.includes(leadId)) {
      throw new NotFoundException({ code: 'not_found', message: 'This offer is not valid for your account' });
    }

    const tenantId = row.tenant_id;
    const claimed = await this.db.tenantTx({ tenantId }, async (tx) => {
      const res = await tx.slotRescueOffer.updateMany({
        where: { id: row.id, tenantId, status: 'OPEN', expiresAt: { gt: new Date() } },
        data: { status: 'CLAIMED', claimedLeadId: leadId },
      });
      if (res.count !== 1) return null;
      return tx.slotRescueOffer.findUniqueOrThrow({ where: { id: row.id } });
    });

    if (!claimed) {
      throw new ConflictException({
        code: 'slot_already_claimed',
        message: 'This slot was just claimed by another guest or has expired.',
      });
    }

    const actor: Actor = {
      tenantId,
      userId: null,
      membershipId: null,
      // lead:write:all: the claimed lead was already validated against this offer's offeredLeadIds above.
      permissions: new Set(['appointment:write', 'appointment:read:all', 'lead:write:all']),
      requestId: undefined,
      ip: undefined,
    };

    try {
      const durationMinutes = Math.max(15, Math.round((claimed.endsAt.getTime() - claimed.startsAt.getTime()) / 60_000));
      const appt = await this.appointments.create(actor, {
        leadId,
        membershipId: claimed.membershipId,
        title: claimed.title,
        startsAt: claimed.startsAt.toISOString(),
        durationMinutes,
        location: claimed.location ?? undefined,
        outsideHours: true,
      });

      const createdNotifs = await this.db.tenantTx({ tenantId }, async (tx) => {
        await tx.slotRescueOffer.update({
          where: { id: claimed.id },
          data: { claimedAppointmentId: appt.id },
        });
        await this.audit.record(tx, {
          tenantId,
          actorUserId: null,
          action: 'slot_rescue.claimed',
          resourceType: 'slot_rescue',
          resourceId: claimed.id,
          metadata: { leadId, appointmentId: appt.id },
        });
        return this.notifications.create(tx, {
          tenantId,
          membershipIds: [claimed.membershipId],
          type: 'appointment_booked',
          title: `Slot rescued! ${appt.leadName} claimed the freed slot`,
          link: `/appointments?a=${appt.id}`,
          data: { appointmentId: appt.id, slotRescueId: claimed.id },
        });
      });
      this.notifications.publish(tenantId, createdNotifs);

      return { ok: true, appointmentId: appt.id, startsAt: appt.startsAt };
    } catch (e) {
      // Revert offer back to OPEN if booking failed (e.g. agent became busy)
      await this.db
        .tenantTx({ tenantId }, (tx) =>
          tx.slotRescueOffer.updateMany({
            where: { id: claimed.id, status: 'CLAIMED', claimedAppointmentId: null },
            data: { status: 'OPEN', claimedLeadId: null },
          }),
        )
        .catch(() => undefined);
      throw e;
    }
  }
}
