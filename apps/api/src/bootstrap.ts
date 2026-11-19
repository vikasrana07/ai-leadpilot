import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { createLogger, type JsonLogger } from './observability/logger.js';

/** HTTP-level configuration shared by the real server and the integration tests, so tests exercise the same CORS/headers. */
export function configureApp(app: NestExpressApplication, env: ReturnType<typeof loadEnv>): void {
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'connect-src': ["'self'", 'https://api.razorpay.com', 'wss:'],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
  // Public widget endpoints are called from customers' websites with a bearer session token (no cookies), so any origin
  // may reach them at the CORS layer; the widget service enforces the owner's allow-list per widget key.
  app.enableCors((req: { url?: string }, cb: (err: Error | null, opts: object) => void) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const isWidget = path.startsWith('/widget/') || path === '/widget.js';
    cb(null, isWidget
      ? { origin: true, credentials: false, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['content-type', 'authorization', 'x-turnstile-token'], maxAge: 600 }
      : { origin: [env.WEB_ORIGIN], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'x-token-delivery', 'x-turnstile-token'] });
  });
  setupSwagger(app);
  app.enableShutdownHooks();
}

export function setupSwagger(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('LeadPilot API')
    .setDescription('LeadPilot REST API specification')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('session')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  return document;
}

export async function createApp(logger: JsonLogger = createLogger()): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false, rawBody: true, logger });
  configureApp(app, env);
  return app;
}
