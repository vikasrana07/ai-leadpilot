import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { createLogger, installProcessHandlers } from './observability/index.js';

const logger = createLogger();
installProcessHandlers(logger);
const app = await createApp(logger);
const port = Number(process.env.API_PORT ?? 4000);
await app.listen(port);
new Logger('Bootstrap').log(`API listening on :${port}`);
