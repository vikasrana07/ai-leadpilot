import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '../db/db.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { OutboxService } from '../ops/outbox.service.js';
import { normalizePhone } from '../common/phone.js';
import type { Actor } from '../common/actor.js';

export interface ExotelCallWebhookPayload {
  CallSid?: string;
  From?: string;
  To?: string;
  DialCallDuration?: string | number;
  Status?: string;
  RecordingUrl?: string;
  Direction?: string;
  StartTime?: string;
  EndTime?: string;
}

export interface TelephonyCallRecord {
  callSid: string;
  customerPhone: string;
  businessPhone?: string;
  durationSeconds: number;
  status: 'COMPLETED' | 'MISSED' | 'BUSY' | 'FAILED';
  recordingUrl?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  timestamp: Date;
}

export function parseExotelPayload(body: unknown): TelephonyCallRecord | null {
  const b = (body ?? {}) as ExotelCallWebhookPayload;
  const rawCustomerPhone = b.Direction === 'outbound-dial' ? b.To : b.From;
  const rawBusinessPhone = b.Direction === 'outbound-dial' ? b.From : b.To;

  if (!rawCustomerPhone) return null;

  const rawDuration = typeof b.DialCallDuration === 'number' ? b.DialCallDuration : parseInt(String(b.DialCallDuration ?? '0'), 10);
  const statusStr = (b.Status ?? '').toLowerCase();
  const status: TelephonyCallRecord['status'] =
    statusStr === 'completed'
      ? 'COMPLETED'
      : statusStr === 'busy'
        ? 'BUSY'
        : statusStr === 'no-answer' || statusStr === 'failed'
          ? 'MISSED'
          : 'COMPLETED';

  return {
    callSid: b.CallSid ?? uuidv7(),
    customerPhone: rawCustomerPhone,
    businessPhone: rawBusinessPhone,
    durationSeconds: Number.isNaN(rawDuration) ? 0 : rawDuration,
    status,
    recordingUrl: b.RecordingUrl ?? null,
    direction: b.Direction === 'outbound-dial' ? 'OUTBOUND' : 'INBOUND',
    timestamp: b.StartTime ? new Date(b.StartTime) : new Date(),
  };
}

@Injectable()
export class TelephonyService {
  private readonly log = new Logger(TelephonyService.name);

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

  /** Logs completed phone call and recording into customer 360 timeline */
  async logCall(tenantId: string, record: TelephonyCallRecord): Promise<{ leadId: string; activityId: string }> {
    const phone = normalizePhone(record.customerPhone);
    if (!phone) {
      throw new Error(`Cannot log call: invalid phone number "${record.customerPhone}"`);
    }

    return this.db.tenantTx({ tenantId }, async (tx) => {
      // 1. Locate matching lead
      const dupes = await this.leads.findDuplicates(tx, tenantId, phone.norm, null);
      let leadId: string;

      if (dupes[0]) {
        leadId = dupes[0].id;
        await tx.lead.update({
          where: { id: leadId },
          data: { lastContactedAt: new Date() },
        });
      } else {
        // Auto-create lead for incoming calls if not existing
        const actor = this.systemActor(tenantId);
        const created = await this.leads.createInTx(
          tx,
          actor,
          {
            name: `Caller ${phone.display}`,
            phone: phone.display,
            email: null,
            location: null,
            propertyType: null,
            requirements: null,
            sourceKey: 'walk_in',
          },
          { defaultSource: 'walk_in' },
        );
        leadId = created.lead.id;
      }

      // 2. Attach call activity to timeline
      const activityId = uuidv7();
      await tx.leadActivity.create({
        data: {
          id: activityId,
          tenantId,
          leadId,
          type: 'call_logged',
          data: {
            callSid: record.callSid,
            direction: record.direction,
            status: record.status,
            durationSeconds: record.durationSeconds,
            recordingUrl: record.recordingUrl,
            timestamp: record.timestamp.toISOString(),
          },
        },
      });

      // 3. Emit outbox event
      await this.outbox.emit(tx, tenantId, 'lead.call_logged', {
        leadId,
        callSid: record.callSid,
        durationSeconds: record.durationSeconds,
        status: record.status,
      });

      this.log.log(
        `Call logged for lead ${leadId} in tenant ${tenantId} (${record.direction}, ${record.durationSeconds}s, ${record.status})`,
      );
      return { leadId, activityId };
    });
  }
}
