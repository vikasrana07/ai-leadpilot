import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.module.js';
import { AutomationEngine, type DomainEvent } from './automation-engine.js';
import { EventNotifier } from './event-notifier.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';
import { NotificationsService } from './notifications.service.js';

interface OutboxRow { id: string; tenant_id: string; type: string; payload: Record<string, unknown>; attempts: number }

/**
 * Moves committed domain events to their consumers (notifications, automations). At-least-once: an event is claimed with a short lease
 * (SKIP LOCKED, so any number of relays can run), processed in ONE tenant transaction guarded by an `event_marks` row (so a redelivery
 * after a crash changes nothing), and only then marked processed. Failures are retried with backoff and end up `failed` after 10 tries.
 */
@Injectable()
export class OutboxRelay {
  private readonly log = new Logger('OutboxRelay');
  /** Set by JobsService: how a freshly created run reaches a worker. */
  enqueueRun: (tenantId: string, runId: string) => Promise<void> = async () => undefined;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(EventNotifier) private readonly notifier: EventNotifier,
    @Inject(AutomationEngine) private readonly engine: AutomationEngine,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  async drainOnce(limit = 50): Promise<number> {
    const rows = await this.db.prisma.$queryRaw<OutboxRow[]>`SELECT id, tenant_id, type, payload, attempts FROM claim_outbox_batch(${limit})`;
    for (const r of rows) {
      const ev: DomainEvent = { id: r.id, tenantId: r.tenant_id, type: r.type, payload: r.payload ?? {} };
      try {
        const out = await this.db.tenantTx({ tenantId: ev.tenantId }, async (tx) => {
          const mark = await tx.eventMark.createMany({ data: [{ tenantId: ev.tenantId, key: `relay:${ev.id}` }], skipDuplicates: true });
          if (mark.count === 0) return { created: [], runs: [] as string[] };
          const created = await this.notifier.handle(tx, ev);
          const runs = await this.engine.matchEvent(tx, ev);
          await this.webhooks.enqueue(tx, ev); // outbound webhooks: one delivery row per subscribed endpoint, same transaction
          return { created, runs };
        });
        this.notifications.publish(ev.tenantId, out.created);
        for (const runId of out.runs) await this.enqueueRun(ev.tenantId, runId);
        await this.db.prisma.$executeRaw`SELECT complete_outbox(${ev.id}::uuid)`;
      } catch (e) {
        this.log.error(`Event ${ev.type} ${ev.id} failed (attempt ${r.attempts}): ${e instanceof Error ? e.message : String(e)}`);
        const delay = Math.min(300, 2 ** Math.min(r.attempts, 8));
        await this.db.prisma.$executeRaw`SELECT fail_outbox(${ev.id}::uuid, ${delay}::int)`;
      }
    }
    return rows.length;
  }
}
