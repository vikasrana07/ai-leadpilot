import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { Redis } from 'ioredis';

const SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blocked} end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) and tonumber(ARGV[3]) > 0 then redis.call('SET', KEYS[2], '1', 'PX', ARGV[3]); return {hits, ttl, 1, tonumber(ARGV[3])} end
return {hits, ttl, 0, 0}`;

/**
 * Rate-limit counters shared by every API instance (atomic Lua script). If Redis is unreachable the limiter degrades to per-instance
 * memory instead of failing requests open or closed: a Redis outage must not take the API down, and must not remove rate limiting.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger('Throttler');
  private readonly redis: Redis;
  private readonly fallback = new ThrottlerStorageService();
  private warned = false;

  constructor(url: string, private readonly prefix: string) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', () => undefined);
    void this.redis.connect().catch(() => undefined);
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    try {
      const k = `${this.prefix}:throttle:${throttlerName}:${key}`;
      const [hits, pttl, blocked, blockPttl] = (await this.redis.eval(SCRIPT, 2, k, `${k}:block`, ttl, limit, blockDuration)) as [number, number, number, number];
      this.warned = false;
      return { totalHits: hits, timeToExpire: Math.max(0, Math.ceil(pttl / 1000)), isBlocked: blocked === 1, timeToBlockExpire: Math.max(0, Math.ceil(blockPttl / 1000)) };
    } catch (e) {
      if (!this.warned) { this.warned = true; this.log.error(`Redis unavailable, rate limits are per-instance until it returns: ${e instanceof Error ? e.message : String(e)}`); }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  close(): void { this.redis.disconnect(); }
}
