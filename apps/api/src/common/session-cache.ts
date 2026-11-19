import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from './tokens.js';
import type { Env } from '../config/env.js';

/**
 * Caches valid user sessions in Redis to eliminate redundant database lookups
 * on high-frequency authenticated requests (guards.ts).
 * Invalidation is triggered on logout, session revocation, user deactivation, and password reset.
 */
@Injectable()
export class SessionCacheService implements OnApplicationShutdown {
  private readonly log = new Logger('SessionCache');
  private redis: Redis | null = null;
  private warned = false;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (this.env.NODE_ENV !== 'test') {
      try {
        this.redis = new Redis(this.env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 1500,
        });
        this.redis.on('error', (err) => {
          if (!this.warned) {
            this.warned = true;
            this.log.warn(`Redis session cache error: ${err.message}. Falling back to database.`);
          }
        });
        void this.redis.connect().catch(() => undefined);
      } catch (e) {
        this.log.warn(`Could not initialize Redis session cache: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private key(sessionId: string): string {
    return `${this.env.QUEUE_PREFIX}:session:${sessionId}`;
  }

  private userKey(userId: string): string {
    return `${this.env.QUEUE_PREFIX}:user_revoked:${userId}`;
  }

  /**
   * Returns cached userId if session is active and valid, null on cache miss or error.
   */
  async getValidSessionUserId(sessionId: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const val = await this.redis.get(this.key(sessionId));
      if (!val) return null;

      // Check if user was globally revoked recently
      const userRevoked = await this.redis.get(this.userKey(val));
      if (userRevoked) {
        await this.invalidate(sessionId);
        return null;
      }

      this.warned = false;
      return val;
    } catch {
      return null;
    }
  }

  /**
   * Caches valid session status for 90s (TTL 60-120s range).
   */
  async setValidSession(sessionId: string, userId: string, ttlSeconds = 90): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(this.key(sessionId), userId, 'EX', ttlSeconds);
    } catch {
      // Non-blocking fallback
    }
  }

  /**
   * Immediately invalidates a session in Redis on logout or revocation.
   */
  async invalidate(sessionId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.key(sessionId));
    } catch {
      // Non-blocking fallback
    }
  }

  /**
   * Immediately invalidates all sessions for a user (e.g. on password reset, deactivation).
   */
  async invalidateUser(userId: string, sessionIds?: string[]): Promise<void> {
    if (!this.redis) return;
    try {
      // Set user revocation marker for 120s (exceeding session cache TTL)
      await this.redis.set(this.userKey(userId), '1', 'EX', 120);
      if (sessionIds?.length) {
        const keys = sessionIds.map((id) => this.key(id));
        await this.redis.del(...keys);
      }
    } catch {
      // Non-blocking fallback
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
  }
}
