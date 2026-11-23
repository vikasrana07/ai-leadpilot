import { describe, expect, it, vi } from 'vitest';
import {
  AI_DOCS_QUEUE,
  JobsService,
  MAINTENANCE_QUEUE,
  RUNS_QUEUE,
  WEBHOOKS_QUEUE,
  redisConnection,
} from '../src/ops/jobs.service.js';
import type { Env } from '../src/config/env.js';

describe('Specialized Worker Tiers (worker-outbox vs worker-ai)', () => {
  it('defines distinct queue names for outbox and AI workloads', () => {
    expect(RUNS_QUEUE).toBe('automation-runs');
    expect(MAINTENANCE_QUEUE).toBe('maintenance');
    expect(WEBHOOKS_QUEUE).toBe('webhook-deliveries');
    expect(AI_DOCS_QUEUE).toBe('ai-knowledge-docs');
  });

  it('parses Redis connection URLs with auth, db and rediss TLS', () => {
    const plain = redisConnection('redis://:secret@cache.internal:6379/2') as any;
    expect(plain.host).toBe('cache.internal');
    expect(plain.port).toBe(6379);
    expect(plain.password).toBe('secret');
    expect(plain.db).toBe(2);
    expect(plain.tls).toBeUndefined();

    const secure = redisConnection('rediss://user:p%40ss@tls-redis.prod:6380') as any;
    expect(secure.host).toBe('tls-redis.prod');
    expect(secure.port).toBe(6380);
    expect(secure.username).toBe('user');
    expect(secure.password).toBe('p@ss');
    expect(secure.tls).toEqual({});
  });

  it('heartbeat instance ID includes the configured worker tier', async () => {
    const { WorkerHeartbeat } = await import('../src/ops/worker-heartbeat.js');
    const mockEnv = {
      REDIS_URL: 'redis://localhost:6379',
      QUEUE_PREFIX: 'leadpilot_test',
      WORKER_TIER: 'outbox',
    } as unknown as Env;

    const hbOutbox = new WorkerHeartbeat(mockEnv);
    expect(hbOutbox.instanceId).toContain('outbox');

    const mockAiEnv = {
      ...mockEnv,
      WORKER_TIER: 'ai',
    } as unknown as Env;
    const hbAi = new WorkerHeartbeat(mockAiEnv);
    expect(hbAi.instanceId).toContain('ai');
  });

  it('JobsService skips startup if WORKERS_ENABLED is false', async () => {
    const mockEnv = {
      WORKERS_ENABLED: false,
      WORKER_TIER: 'outbox',
      REDIS_URL: 'redis://localhost:6379',
      QUEUE_PREFIX: 'leadpilot',
    } as unknown as Env;

    const service = new JobsService(
      mockEnv,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { start: () => {} } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.onApplicationBootstrap();
    expect(service.running).toBe(false);
  });
});
