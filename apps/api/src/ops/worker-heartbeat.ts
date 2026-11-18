import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export const HEARTBEAT_EVERY_MS = 30_000;
export const HEARTBEAT_TTL_SECONDS = 90;

export interface Heartbeat { instanceId: string; startedAt: string; lastBeat: string; version: string | null }

export const heartbeatKey = (prefix: string, instanceId: string): string => `${prefix}:worker:heartbeat:${instanceId}`;

/** Reads every live heartbeat (a key that expired belongs to a worker that stopped). Works with any ioredis client. */
export async function readHeartbeats(redis: Pick<Redis, 'scan' | 'mget'>, prefix: string): Promise<Heartbeat[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}:worker:heartbeat:*`, 'COUNT', 100);
    cursor = next; keys.push(...batch);
  } while (cursor !== '0' && keys.length < 500);
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  const out: Heartbeat[] = [];
  for (const v of values) { if (!v) continue; try { out.push(JSON.parse(v) as Heartbeat); } catch { /* ignore a corrupt value */ } }
  return out;
}

/**
 * "Is a background worker alive?" Each worker process writes a Redis key with a 90 s lifetime every 30 s. If every key has expired, no
 * worker is running (or Redis is down). Redis trouble is logged once and never crashes the process.
 */
@Injectable()
export class WorkerHeartbeat implements OnApplicationShutdown {
  private readonly log = new Logger('Heartbeat');
  readonly instanceId = `${hostname().replace(/[^A-Za-z0-9.-]/g, '').slice(0, 24) || 'host'}-${process.pid}-${randomBytes(3).toString('hex')}`;
  private readonly startedAt = new Date().toISOString();
  private redis: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private warned = false;

  constructor(@Inject(ENV) private readonly env: Env) {}

  client(): Redis {
    this.redis ??= new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500 });
    this.redis.on('error', () => undefined); // surfaced through beat()'s catch, once
    return this.redis;
  }

  start(): void {
    if (this.timer) return;
    void this.beat();
    this.timer = setInterval(() => { void this.beat(); }, HEARTBEAT_EVERY_MS);
    this.timer.unref();
  }

  async beat(): Promise<boolean> {
    try {
      const r = this.client();
      if (r.status === 'wait' || r.status === 'end') await r.connect();
      const hb: Heartbeat = { instanceId: this.instanceId, startedAt: this.startedAt, lastBeat: new Date().toISOString(), version: process.env.GIT_SHA ?? process.env.APP_VERSION ?? null };
      await r.set(heartbeatKey(this.env.QUEUE_PREFIX, this.instanceId), JSON.stringify(hb), 'EX', HEARTBEAT_TTL_SECONDS);
      this.warned = false;
      return true;
    } catch (e) {
      if (!this.warned) { this.warned = true; this.log.warn(`Heartbeat not written (Redis unavailable): ${e instanceof Error ? e.message : String(e)}`); }
      return false;
    }
  }

  /** Like list(), but null when Redis cannot be read (so "no workers" can be told apart from "cannot tell"). */
  async listOrNull(): Promise<Heartbeat[] | null> {
    try {
      const r = this.client();
      if (r.status === 'wait' || r.status === 'end') await r.connect();
      return await readHeartbeats(r, this.env.QUEUE_PREFIX);
    } catch { return null; }
  }

  async list(): Promise<Heartbeat[]> {
    try {
      const r = this.client();
      if (r.status === 'wait' || r.status === 'end') await r.connect();
      return await readHeartbeats(r, this.env.QUEUE_PREFIX);
    } catch { return []; }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { await this.redis?.del(heartbeatKey(this.env.QUEUE_PREFIX, this.instanceId)); } catch { /* best effort: it expires anyway */ }
    this.redis?.disconnect();
    this.redis = null;
  }
}
