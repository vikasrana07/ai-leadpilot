import { Global, Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { AppointmentsService } from './appointments.service.js';
import { AutomationEngine } from './automation-engine.js';
import { AutomationsService } from './automations.service.js';
import { EventNotifier } from './event-notifier.js';
import { JobsService } from './jobs.service.js';
import { NotificationsService } from './notifications.service.js';
import { AppointmentsController, NotificationsController } from './ops.controller.js';
import { AutomationsController, SlaController, TasksController } from './ops2.controller.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxService } from './outbox.service.js';
import { ScannersService } from './scanners.service.js';
import { SlaService } from './sla.service.js';
import { TasksService } from './tasks.service.js';

/** The outbox writer is needed by almost every module, so it lives in its own tiny global module with no dependencies. */
@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}

@Module({
  imports: [LeadsModule, ConversationsModule],
  controllers: [AppointmentsController, NotificationsController, AutomationsController, TasksController, SlaController],
  providers: [NotificationsService, AppointmentsService, AutomationEngine, AutomationsService, EventNotifier, OutboxRelay, ScannersService, SlaService, TasksService, JobsService],
  exports: [AppointmentsService, NotificationsService, OutboxRelay, ScannersService, JobsService, AutomationEngine],
})
export class OpsModule {}
