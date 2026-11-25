import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { ENV } from '../common/tokens.js';
import { metrics } from '../observability/metrics.js';
import { runWithLogContext } from '../observability/request-context.js';
import { ChannelHealth } from './channel-health.js';
import { AlertsService } from './alerts.service.js';
import { HealthSnapshotService } from './health-snapshot.service.js';
import { WorkerHeartbeat } from './worker-heartbeat.js';
import type { Env } from '../config/env.js';
import { AutomationEngine } from './automation-engine.js';
import { LifecycleJobs } from './lifecycle-jobs.js';
import { OutboxRelay } from './outbox-relay.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';
import { ScannersService } from './scanners.service.js';

export const RUNS_QUEUE = 'automation-runs';
export const MAINTENANCE_QUEUE = 'maintenance';
export const WEBHOOKS_QUEUE = 'webhook-deliveries';
export const AI_DOCS_QUEUE = 'ai-knowledge-docs';
export const CAMPAIGNS_QUEUE = 'broadcast-campaigns';

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), ...(u.password ? { password: decodeURIComponent(u.password) } : {}), ...(u.username ? { username: decodeURIComponent(u.username) } : {}), ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}), ...(u.protocol === 'rediss:' ? { tls: {} } : {}) };
}

/**
 * Background processing, only active when WORKERS_ENABLED=true (the `apps/worker` process, or the API in single-process dev).
 *   - outbox relay: polls every second (any number of instances is safe, see OutboxRelay)
 *   - `automation-runs` queue: one BullMQ job per automation run, exponential-backoff retries, failed jobs are kept (the dead-letter set)
 *   - `maintenance` queue: a repeatable job every minute that runs the scanners and re-enqueues orphaned runs
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Jobs');
  private runsQueue: Queue | null = null;
  private maintenanceQueue: Queue | null = null;
  private webhooksQueue: Queue | null = null;
  private aiDocsQueue: Queue | null = null;
  private campaignsQueue: Queue | null = null;
  private readonly workers: Worker[] = [];
  private relayTimer: NodeJS.Timeout | null = null;
  private relayBusy = false;

  /** Hook registered by KnowledgeService to process AI documents */
  processDoc?: (tenantId: string, documentId: string, kind: string) => Promise<void>;

  /** Hook registered by CampaignsService to dispatch campaign batches */
  processCampaignBatch?: (tenantId: string, campaignId: string) => Promise<void>;

  /** Hook registered by CampaignsService to sweep scheduled campaigns */
  checkScheduledCampaigns?: () => Promise<number>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AutomationEngine) private readonly engine: AutomationEngine,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
    @Inject(ScannersService) private readonly scanners: ScannersService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(LifecycleJobs) private readonly lifecycle: LifecycleJobs,
    @Inject(WorkerHeartbeat) private readonly heartbeat: WorkerHeartbeat,
    @Inject(HealthSnapshotService) private readonly snapshot: HealthSnapshotService,
    @Inject(AlertsService) private readonly alerts: AlertsService,
    @Inject(ChannelHealth) private readonly channelHealth: ChannelHealth,
  ) {}

  get running(): boolean { return this.workers.length > 0; }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.WORKERS_ENABLED) return;
    await this.start();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const tier = this.env.WORKER_TIER;
    const connection = redisConnection(this.env.REDIS_URL);
    const prefix = this.env.QUEUE_PREFIX;

    const shouldRunOutbox = tier === 'all' || tier === 'outbox';
    const shouldRunAi = tier === 'all' || tier === 'ai';

    if (shouldRunOutbox) {
      this.runsQueue = new Queue(RUNS_QUEUE, { connection, prefix, defaultJobOptions: { attempts: this.env.AUTOMATION_MAX_ATTEMPTS, backoff: { type: 'exponential', delay: this.env.AUTOMATION_RETRY_BASE_MS }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } } });
      this.maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection, prefix, defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } } });
      this.webhooksQueue = new Queue(WEBHOOKS_QUEUE, { connection, prefix, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 10000 } } });
      this.campaignsQueue = new Queue(CAMPAIGNS_QUEUE, { connection, prefix, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } } });
      this.runsQueue.on('error', (e) => this.log.error(`runs queue: ${e.message}`));
      this.maintenanceQueue.on('error', (e) => this.log.error(`maintenance queue: ${e.message}`));
      this.webhooksQueue.on('error', (e) => this.log.error(`webhooks queue: ${e.message}`));
      this.campaignsQueue.on('error', (e) => this.log.error(`campaigns queue: ${e.message}`));
      this.relay.enqueueRun = (tenantId, runId) => this.enqueueRun(tenantId, runId);
      this.relay.enqueueWebhook = (tenantId, deliveryId) => this.enqueueWebhook(tenantId, deliveryId);
      this.webhooks.enqueueJob = (tenantId, deliveryId, generation) => this.enqueueWebhook(tenantId, deliveryId, generation);

      this.workers.push(new Worker(CAMPAIGNS_QUEUE, async (job: Job<{ tenantId: string; campaignId: string }>) => {
        await runWithLogContext({ jobId: String(job.id ?? job.data.campaignId), tenantId: job.data.tenantId }, async () => {
          if (this.processCampaignBatch) {
            await this.processCampaignBatch(job.data.tenantId, job.data.campaignId);
          }
        });
      }, { connection, prefix, concurrency: 3 }));

      this.workers.push(new Worker(RUNS_QUEUE, async (job: Job<{ tenantId: string; runId: string }>) => {
        const maxAttempts = job.opts.attempts ?? 1;
        await runWithLogContext({ jobId: String(job.id ?? job.data.runId), tenantId: job.data.tenantId }, () => this.engine.execute(job.data.tenantId, job.data.runId, job.attemptsMade + 1 >= maxAttempts));
      }, { connection, prefix, concurrency: 5 }));

      this.workers.push(new Worker(WEBHOOKS_QUEUE, async (job: Job<{ tenantId: string; deliveryId: string }>) => {
        const maxAttempts = job.opts.attempts ?? 5;
        await runWithLogContext({ jobId: String(job.id ?? job.data.deliveryId), tenantId: job.data.tenantId }, () =>
          this.webhooks.deliverJob(job.data.deliveryId, job.data.tenantId, job.attemptsMade + 1, maxAttempts)
        );
      }, { connection, prefix, concurrency: 5 }));

      this.workers.push(new Worker(MAINTENANCE_QUEUE, async () => { await this.maintenance(); }, { connection, prefix, concurrency: 1 }));

      await this.maintenanceQueue.upsertJobScheduler('tick', { every: 60_000 }, { name: 'tick', data: {} });
      this.relayTimer = setInterval(() => { void this.drain(); }, 1000);
    }

    if (shouldRunAi) {
      this.aiDocsQueue = new Queue(AI_DOCS_QUEUE, {
        connection,
        prefix,
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 2000 } },
      });
      this.aiDocsQueue.on('error', (e) => this.log.error(`ai docs queue: ${e.message}`));

      this.workers.push(new Worker(AI_DOCS_QUEUE, async (job: Job<{ tenantId: string; documentId: string; kind: string }>) => {
        await runWithLogContext({ jobId: String(job.id ?? job.data.documentId), tenantId: job.data.tenantId }, async () => {
          if (this.processDoc) {
            await this.processDoc(job.data.tenantId, job.data.documentId, job.data.kind);
          } else {
            this.log.warn(`No processDoc handler registered for AI doc job ${job.data.documentId}`);
          }
        });
      }, { connection, prefix, concurrency: 2 }));
    }

    for (const w of this.workers) w.on('error', (e) => this.log.error(`worker: ${e.message}`));

    this.heartbeat.start();
    this.log.log(`Background workers started (tier: ${tier}, active workers: ${this.workers.length})`);
  }

  /** `jobId` makes enqueueing idempotent per run and delivery generation (a re-queued failed run needs a fresh id). */
  async enqueueRun(tenantId: string, runId: string, generation = 0): Promise<void> {
    if (!this.runsQueue) {
      const connection = redisConnection(this.env.REDIS_URL);
      this.runsQueue = new Queue(RUNS_QUEUE, { connection, prefix: this.env.QUEUE_PREFIX });
    }
    await this.runsQueue.add('run', { tenantId, runId }, { jobId: `${runId}-${generation}` });
  }

  /** `jobId` makes enqueueing idempotent per delivery and generation. */
  async enqueueWebhook(tenantId: string, deliveryId: string, generation = 0): Promise<void> {
    if (!this.webhooksQueue) {
      const connection = redisConnection(this.env.REDIS_URL);
      this.webhooksQueue = new Queue(WEBHOOKS_QUEUE, { connection, prefix: this.env.QUEUE_PREFIX });
    }
    await this.webhooksQueue.add('deliver', { tenantId, deliveryId }, { jobId: `${deliveryId}-${generation}` });
  }

  /** Enqueues broadcast campaign batch dispatching */
  async enqueueCampaignDispatch(tenantId: string, campaignId: string, delayMs = 0): Promise<void> {
    if (!this.campaignsQueue) {
      if (this.processCampaignBatch) {
        void this.processCampaignBatch(tenantId, campaignId).catch((e) =>
          this.log.error(`Campaign direct dispatch failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
      return;
    }
    await this.campaignsQueue.add('dispatch-batch', { tenantId, campaignId }, { jobId: `campaign:${campaignId}:${Date.now()}`, ...(delayMs > 0 ? { delay: delayMs } : {}) });
  }

  /** Enqueues heavy AI document parsing, chunking, and vector embedding calculation to the AI worker tier. */
  async enqueueDocProcessing(tenantId: string, documentId: string, kind: string, generation = 0): Promise<void> {
    if (!this.aiDocsQueue) {
      const connection = redisConnection(this.env.REDIS_URL);
      this.aiDocsQueue = new Queue(AI_DOCS_QUEUE, { connection, prefix: this.env.QUEUE_PREFIX });
    }
    await this.aiDocsQueue.add('process', { tenantId, documentId, kind }, { jobId: `${documentId}-${generation}` });
  }

  private async drain(): Promise<void> {
    if (this.relayBusy) return;
    this.relayBusy = true;
    try {
      while ((await this.relay.drainOnce()) > 0) { /* keep going until the outbox is empty */ }
      while ((await this.webhooks.drainOnce()) > 0) { /* then send due webhook deliveries */ }
    }
    catch (e) { this.log.error(`relay: ${e instanceof Error ? e.message : String(e)}`); }
    finally { this.relayBusy = false; }
  }

  async maintenance(): Promise<void> {
    const started = Date.now();
    let ok = true;
    try { await this.maintenanceBody(); } catch (e) { ok = false; throw e; } finally { metrics.scannerTick(Date.now() - started, ok); }
    // Health snapshot -> gauges, Redis copy for the Ops page and alert rules. Must never fail the maintenance job.
    await this.publishSnapshot().catch((e: unknown) => this.log.error(`snapshot: ${e instanceof Error ? e.message : String(e)}`));
    // Alert rules run right after the snapshot (at most once a minute across all processes; see AlertsService.runLocked). Never fails the job.
    await this.alerts.runLocked().catch((e: unknown) => this.log.error(`alerts: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async publishSnapshot(): Promise<void> {
    const c = this.runsQueue ? await this.runsQueue.getJobCounts('wait', 'active', 'delayed', 'failed').catch(() => null) : null;
    await this.snapshot.tick(c ? { waiting: c.wait ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 } : null);
  }

  private async maintenanceBody(): Promise<void> {
    const reports = await this.scanners.scanAll();
    // data lifecycle: queued workspace exports, expired export files, workspaces past their deletion cooling-off period
    await this.lifecycle.processExports().catch((e: unknown) => this.log.error(`exports: ${e instanceof Error ? e.message : String(e)}`));
    // once a day: test the token of every Facebook-connected WhatsApp number (revoked token -> NEEDS_RECONNECT, owners told once)
    await this.channelHealth.runDaily().catch((e: unknown) => this.log.error(`channel health: ${e instanceof Error ? e.message : String(e)}`));
    await this.lifecycle.purgeDueTenants().catch((e: unknown) => this.log.error(`tenant purge: ${e instanceof Error ? e.message : String(e)}`));
    await this.lifecycle.maintainPartitions().catch((e: unknown) => this.log.error(`partition maintenance: ${e instanceof Error ? e.message : String(e)}`));
    // scheduled campaigns check
    if (this.checkScheduledCampaigns) {
      await this.checkScheduledCampaigns().catch((e: unknown) => this.log.error(`scheduled campaigns: ${e instanceof Error ? e.message : String(e)}`));
    }
    // Orphaned QUEUED runs (job lost, manual retry, stale RUNNING reset) are re-enqueued with a per-minute generation so BullMQ does not drop
    // them as duplicates. Double delivery is harmless: the engine claims a run with a compare-and-set.
    const generation = Math.floor(Date.now() / 60_000);
    for (const rep of reports) for (const id of rep.queuedRuns) await this.enqueueRun(rep.tenantId, id, generation);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.relayTimer = null;
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([
      this.runsQueue?.close(),
      this.maintenanceQueue?.close(),
      this.webhooksQueue?.close(),
      this.aiDocsQueue?.close(),
      this.campaignsQueue?.close(),
    ]);
    this.runsQueue = null;
    this.maintenanceQueue = null;
    this.webhooksQueue = null;
    this.aiDocsQueue = null;
    this.campaignsQueue = null;
    this.workers.length = 0;
  }
}
