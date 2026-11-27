import { Global, Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { GoogleCalendarModule } from '../integrations/google-calendar/google-calendar.module.js';
import { AppointmentsService } from './appointments.service.js';
import { LifecycleJobs } from './lifecycle-jobs.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';
import { BillingLifecycle } from './billing-lifecycle.js';
import { BillingNotifier } from './billing-notify.js';
import { ChannelHealth } from './channel-health.js';
import { AutomationEngine } from './automation-engine.js';
import { AutomationsService } from './automations.service.js';
import { EventNotifier } from './event-notifier.js';
import { JobsService } from './jobs.service.js';
import { AlertSettingsController } from './alert-settings.js';
import { AlertsService } from './alerts.service.js';
import { HealthSnapshotService } from './health-snapshot.service.js';
import { WorkerHeartbeat } from './worker-heartbeat.js';
import { NotificationsService } from './notifications.service.js';
import { AppointmentsController, NotificationsController } from './ops.controller.js';
import { AutomationsController, SlaController, TasksController } from './ops2.controller.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxService } from './outbox.service.js';
import { ScannersService } from './scanners.service.js';
import { SlaService } from './sla.service.js';
import { SlotRescueAdminController, SlotRescuePublicController } from './slot-rescue.controller.js';
import { SlotRescueService } from './slot-rescue.service.js';
import { TasksService } from './tasks.service.js';
import { WebPushService } from './web-push.service.js';

/** The outbox writer is needed by almost every module, so it lives in its own tiny global module with no dependencies. */
@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}

@Module({
  imports: [LeadsModule, ConversationsModule, ChannelsModule, GoogleCalendarModule],
  controllers: [SlotRescueAdminController, AppointmentsController, SlotRescuePublicController, NotificationsController, AlertSettingsController, AutomationsController, TasksController, SlaController],
  providers: [ChannelHealth, WebhookDispatcher, LifecycleJobs, BillingNotifier, BillingLifecycle, NotificationsService, WebPushService, AppointmentsService, SlotRescueService, AutomationEngine, AutomationsService, EventNotifier, OutboxRelay, ScannersService, SlaService, TasksService, JobsService, WorkerHeartbeat, HealthSnapshotService, AlertsService],
  exports: [ChannelHealth, WebhookDispatcher, LifecycleJobs, BillingNotifier, AppointmentsService, SlotRescueService, NotificationsService, WebPushService, OutboxRelay, ScannersService, JobsService, AutomationEngine, WorkerHeartbeat, HealthSnapshotService, AlertsService],
})
export class OpsModule {}
