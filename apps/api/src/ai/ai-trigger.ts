import { Injectable } from '@nestjs/common';

export interface InboundEvent { tenantId: string; conversationId: string; messageId: string }

/**
 * Decouples inbound message handling (conversations module) from the AI orchestrator without a circular dependency.
 * The orchestrator registers itself as the handler on startup; if the AI module is absent nothing happens.
 */
@Injectable()
export class AiTrigger {
  handler: ((e: InboundEvent) => void) | null = null;
  fire(e: InboundEvent): void { this.handler?.(e); }
}
