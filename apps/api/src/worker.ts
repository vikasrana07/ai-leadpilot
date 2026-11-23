import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { createLogger, installProcessHandlers } from './observability/index.js';

/**
 * Background process: same modules as the API, no HTTP listener. WORKERS_ENABLED must be true (apps/worker sets it), which starts the
 * outbox relay, the BullMQ workers and the minute scheduler inside JobsService.
 */
process.env.WORKERS_ENABLED = 'true';
process.env.WORKER_TIER = process.env.WORKER_TIER ?? 'all';
process.env.LP_PROCESS = 'worker';
const logger = createLogger();
installProcessHandlers(logger);
const app = await NestFactory.createApplicationContext(AppModule, { logger });
app.enableShutdownHooks();
new Logger('Worker').log('Worker running (relay, automation queue, scheduler)');
