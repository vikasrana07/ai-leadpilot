import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module.js';

/**
 * Background process: same modules as the API, no HTTP listener. WORKERS_ENABLED must be true (apps/worker sets it), which starts the
 * outbox relay, the BullMQ workers and the minute scheduler inside JobsService.
 */
process.env.WORKERS_ENABLED = 'true';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
app.enableShutdownHooks();
new Logger('Worker').log('Worker running (relay, automation queue, scheduler)');
