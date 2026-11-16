import { Controller, Get, Inject, Module, type OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Public } from '../common/decorators.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';

const within = <T>(p: Promise<T>, ms: number): Promise<T> => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

@Controller('health')
class HealthController implements OnApplicationShutdown {
  private redis: Redis | null = null;
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env) {}

  /** Liveness: the process is up. Never touches dependencies (a DB blip must not make the orchestrator restart healthy pods). */
  @Public() @Get() live() { return { status: 'ok' }; }

  /**
   * Readiness: can this instance serve traffic? The database is required (503 when down). Redis only degrades (rate limits fall back to
   * per-instance memory; queues pause), so it is reported but does not take the instance out of rotation.
   */
  @Public() @Get('ready')
  async ready() {
    try { await within(this.db.prisma.$queryRaw`SELECT 1`, 2000); } catch { throw new ServiceUnavailableException({ code: 'db_unavailable', message: 'Database unavailable' }); }
    const redis = await this.redisState();
    return { status: 'ready', db: 'up', redis };
  }

  private async redisState(): Promise<'up' | 'down'> {
    try {
      this.redis ??= new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 1000 });
      if (this.redis.status === 'wait' || this.redis.status === 'end') await within(this.redis.connect(), 1500);
      await within(this.redis.ping(), 1000);
      return 'up';
    } catch { return 'down'; }
  }

  onApplicationShutdown(): void { this.redis?.disconnect(); }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
