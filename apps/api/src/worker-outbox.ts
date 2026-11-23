import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { createLogger, installProcessHandlers } from './observability/index.js';

/**
 * Specialized Worker Tier: Outbox Relay & Webhook Dispatcher
 *
 * Dedicated to real-time, low-latency background operations:
 * - Draining transactional outbox rows every 1 second (WhatsApp message dispatch)
 * - Delivering outgoing HTTP webhooks
 * - Running event-driven automation rules
 * - Running 60s maintenance checks
 *
 * Excludes heavy PDF parsing and vector embedding generation to guarantee sub-second message delivery.
 */
process.env.WORKERS_ENABLED = 'true';
process.env.WORKER_TIER = 'outbox';
process.env.LP_PROCESS = 'worker-outbox';

const logger = createLogger();
installProcessHandlers(logger);

const app = await NestFactory.createApplicationContext(AppModule, { logger });
app.enableShutdownHooks();

new Logger('WorkerOutbox').log('Outbox Worker running (real-time outbox relay, webhooks, automation queue, scheduler)');
