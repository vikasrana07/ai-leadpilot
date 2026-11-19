import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.NODE_ENV = 'test';
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3100';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://leadpilot_app:secret@localhost:5432/leadpilot';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-secret-dev-secret-dev-secret-dev-secret-32b';
process.env.LOCAL_MASTER_KEY = process.env.LOCAL_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function generate() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    logger: false,
  });

  const config = new DocumentBuilder()
    .setTitle('LeadPilot API')
    .setDescription('LeadPilot REST API specification')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('session')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const rootDir = path.resolve(__dirname, '../../..');
  const outDir = path.join(rootDir, 'packages/shared-types');
  const targetFile = path.join(outDir, 'openapi.json');

  await fs.writeFile(targetFile, JSON.stringify(document, null, 2), 'utf-8');
  console.log(`Successfully generated OpenAPI spec at: ${targetFile}`);

  await app.close();
  process.exit(0);
}

generate().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
