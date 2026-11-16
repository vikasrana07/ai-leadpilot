import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';

/** Domain events travel in the same transaction as the change that caused them (transactional outbox, ADR-0004). */
export interface DomainEventPayload extends Record<string, Prisma.InputJsonValue | null | undefined> {
  /** Chain protection: events caused by an automation carry depth+1 and the automation id. */
  depth?: number;
  originAutomationId?: string;
}

/** Loop-protection fields to merge into any event an automation causes. */
export function originOf(a: { origin?: { automationId: string; depth: number } | undefined }): { depth?: number; originAutomationId?: string } {
  return a.origin ? { depth: a.origin.depth + 1, originAutomationId: a.origin.automationId } : {};
}

@Injectable()
export class OutboxService {
  async emit(tx: TxClient, tenantId: string, type: string, payload: DomainEventPayload): Promise<void> {
    await tx.outboxEvent.create({ data: { id: uuidv7(), tenantId, type, payload: payload as Prisma.InputJsonObject } });
  }
}
