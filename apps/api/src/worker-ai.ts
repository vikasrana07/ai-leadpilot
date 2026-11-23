import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { createLogger, installProcessHandlers } from './observability/index.js';

/**
 * Specialized Worker Tier: AI Knowledge & Document Processing
 *
 * Dedicated to compute-intensive, asynchronous document pipelines:
 * - PDF, DOCX, TXT and CSV parsing (unpdf, mammoth)
 * - Anti-prompt-injection sanitization
 * - Chunking and OpenAI vector embedding generation (text-embedding-3-small)
 * - Virus scanning (ClamAV daemon)
 *
 * Runs on isolated CPU/memory quotas without causing event-loop jitter in the outbox relay.
 */
process.env.WORKERS_ENABLED = 'true';
process.env.WORKER_TIER = 'ai';
process.env.LP_PROCESS = 'worker-ai';

const logger = createLogger();
installProcessHandlers(logger);

const app = await NestFactory.createApplicationContext(AppModule, { logger });
app.enableShutdownHooks();

new Logger('WorkerAi').log('AI Worker running (ai-knowledge-docs queue, vector embeddings, document extraction)');
