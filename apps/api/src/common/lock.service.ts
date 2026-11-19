import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { ENV } from './tokens.js';
import type { Env } from '../config/env.js';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

@Injectable()
export class DistributedLockService implements OnApplicationShutdown {
  private readonly log = new Logger('DistributedLock');
  private readonly redis: Redis | null = null;

  constructor(@Inject(ENV) env: Env) {
    if (env.NODE_ENV !== 'test' && env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.redis.on('error', () => undefined);
      void this.redis.connect().catch(() => undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  /**
   * Runs the given async callback inside a short distributed lock (redlock pattern for single Redis instance).
   * Keyed by e.g. `tenantId:memberId:startsAt`.
   * If Redis is unreachable or running in tests, executes `fn()` directly (PostgreSQL transactions and constraints provide the safety net).
   */
  async withLock<T>(key: string, ttlMs = 5000, fn: () => Promise<T>): Promise<T> {
    if (!this.redis || this.redis.status !== 'ready') {
      return fn();
    }

    const fullKey = `lock:${key}`;
    const token = randomBytes(16).toString('hex');
    let acquired = false;

    try {
      // Attempt up to 3 times with brief backoff
      for (let i = 0; i < 3; i++) {
        const res = await this.redis.set(fullKey, token, 'PX', ttlMs, 'NX').catch(() => null);
        if (res === 'OK') {
          acquired = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 25));
      }

      if (!acquired) {
        throw new Error('LOCK_NOT_ACQUIRED');
      }

      return await fn();
    } finally {
      if (acquired && this.redis && this.redis.status === 'ready') {
        try {
          await this.redis.eval(RELEASE_SCRIPT, 1, fullKey, token);
        } catch {
          // ignore release errors
        }
      }
    }
  }
}
