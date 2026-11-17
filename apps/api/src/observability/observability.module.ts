import { Global, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { EmfEmitter } from './emf.js';
import { metrics } from './metrics.js';

/** Which process this is, for the `Service` dimension. The worker entry point sets LP_PROCESS=worker; everything else is the API. */
export const serviceName = (): 'api' | 'worker' => (process.env.LP_PROCESS === 'worker' ? 'worker' : 'api');

/**
 * Writes the in-process metrics as CloudWatch EMF lines every METRICS_INTERVAL_SECONDS and once more on shutdown.
 * METRICS_EMF: on by default in production, off elsewhere (the registry still records, which is cheap; only the output is gated).
 */
@Injectable()
export class MetricsEmitterService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly emitter: EmfEmitter;
  constructor(@Inject(ENV) env: Env) {
    this.emitter = new EmfEmitter({
      collect: () => metrics.collect(), service: serviceName(), intervalMs: env.METRICS_INTERVAL_SECONDS * 1000,
      enabled: env.METRICS_EMF ?? env.NODE_ENV === 'production',
    });
  }
  onApplicationBootstrap(): void { this.emitter.start(); if (metrics.registry.droppedSeries > 0) new Logger('Metrics').warn('Some metric series were dropped (series cap reached)'); }
  onApplicationShutdown(): void { this.emitter.stop(); }
}

@Global()
@Module({ providers: [MetricsEmitterService], exports: [MetricsEmitterService] })
export class ObservabilityModule {}
