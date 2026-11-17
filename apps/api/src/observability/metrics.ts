/**
 * Tiny in-process metrics registry (no dependency). Counters and histograms are DELTAS since the last flush (collect() resets them),
 * gauges keep their last value. Every metric declares its dimensions and the allowed values of each, so the number of series is bounded
 * by construction: an undeclared label is dropped, an unknown value collapses to `other`, and a per-metric series cap is a last backstop.
 * Nothing here ever takes a tenant id, user id or raw path as a label.
 */
export type Unit = 'Count' | 'Milliseconds' | 'Seconds' | 'None';
export type Labels = Record<string, string>;

export interface MetricDef {
  name: string;
  kind: 'counter' | 'gauge' | 'histogram';
  unit: Unit;
  /** dimension name -> allowed values (anything else becomes `other`). */
  dims?: Record<string, readonly string[]>;
  /** true: declared to CloudWatch as a billable custom metric. false: written as a plain log field (free, searchable with Logs Insights). */
  billable: boolean;
  /** histogram only: bucket upper bounds, ascending. */
  buckets?: readonly number[];
  /** histogram only: also emit an estimated p95 as a separate metric `<name>P95<Unit suffix>`. */
  p95?: boolean;
}

export interface Sample {
  def: MetricDef;
  labels: Labels;
  /** counters and gauges */
  value?: number;
  /** histograms */
  stats?: { count: number; sum: number; min: number; max: number; p95?: number };
}

const DEFAULT_MS_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000] as const;
const MAX_SERIES_DEFAULT = 64;

interface Series { labels: Labels; value: number; count: number; sum: number; min: number; max: number; buckets: number[]; touched: boolean }

class Metric {
  private readonly series = new Map<string, Series>();
  constructor(readonly def: MetricDef, private readonly maxSeries: number, private readonly onDrop: () => void) {}

  private labelsFor(raw?: Labels): Labels {
    const out: Labels = {};
    for (const [dim, allowed] of Object.entries(this.def.dims ?? {})) {
      const v = raw?.[dim];
      out[dim] = v !== undefined && allowed.includes(v) ? v : 'other';
    }
    return out; // keys not declared in def.dims are ignored: a caller cannot widen the label space
  }

  private seriesFor(raw?: Labels): Series | null {
    const labels = this.labelsFor(raw);
    const key = Object.values(labels).join('|');
    let s = this.series.get(key);
    if (!s) {
      if (this.series.size >= this.maxSeries) { this.onDrop(); return null; }
      s = { labels, value: 0, count: 0, sum: 0, min: Infinity, max: -Infinity, buckets: new Array((this.def.buckets?.length ?? 0) + 1).fill(0) as number[], touched: false };
      this.series.set(key, s);
    }
    return s;
  }

  inc(labels?: Labels, n = 1): void { const s = this.seriesFor(labels); if (s) { s.value += n; s.touched = true; } }
  set(value: number, labels?: Labels): void { const s = this.seriesFor(labels); if (s) { s.value = value; s.touched = true; } }
  observe(value: number, labels?: Labels): void {
    const s = this.seriesFor(labels); if (!s || !Number.isFinite(value)) return;
    s.count++; s.sum += value; s.min = Math.min(s.min, value); s.max = Math.max(s.max, value); s.touched = true;
    const b = this.def.buckets ?? [];
    let i = b.findIndex((ub) => value <= ub); if (i < 0) i = b.length;
    s.buckets[i] = (s.buckets[i] ?? 0) + 1;
  }

  /** Samples with activity since the last collect (gauges: always the last value once set). Counters and histograms reset. */
  collect(): Sample[] {
    const out: Sample[] = [];
    for (const s of this.series.values()) {
      if (!s.touched) continue;
      if (this.def.kind === 'gauge') { out.push({ def: this.def, labels: s.labels, value: s.value }); continue; }
      if (this.def.kind === 'counter') { out.push({ def: this.def, labels: s.labels, value: s.value }); s.value = 0; s.touched = false; continue; }
      const stats = { count: s.count, sum: s.sum, min: s.min, max: s.max, ...(this.def.p95 ? { p95: estimatePercentile(this.def.buckets ?? [], s.buckets, s.count, 0.95, s.max) } : {}) };
      out.push({ def: this.def, labels: s.labels, stats });
      s.count = 0; s.sum = 0; s.min = Infinity; s.max = -Infinity; s.buckets.fill(0); s.touched = false;
    }
    return out;
  }
}

/** Percentile estimate from fixed buckets (linear inside the bucket; the open top bucket is capped by the observed maximum). */
export function estimatePercentile(bounds: readonly number[], counts: readonly number[], total: number, q: number, observedMax: number): number {
  if (total <= 0) return 0;
  const rank = q * total;
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0;
    if (seen + c >= rank && c > 0) {
      const lower = i === 0 ? 0 : (bounds[i - 1] ?? 0);
      const upper = i < bounds.length ? (bounds[i] as number) : Math.max(observedMax, lower);
      const est = lower + ((rank - seen) / c) * (upper - lower);
      return Math.round(Math.min(est, observedMax) * 10) / 10;
    }
    seen += c;
  }
  return observedMax;
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();
  private dropped = 0;
  constructor(private readonly maxSeries = MAX_SERIES_DEFAULT) {}

  define(def: MetricDef): Metric {
    const existing = this.metrics.get(def.name);
    if (existing) return existing;
    const m = new Metric(def, this.maxSeries, () => { this.dropped++; });
    this.metrics.set(def.name, m);
    return m;
  }
  get(name: string): Metric | undefined { return this.metrics.get(name); }
  /** Number of samples refused because a metric hit its series cap (should stay 0). */
  get droppedSeries(): number { return this.dropped; }
  collect(): Sample[] { return [...this.metrics.values()].flatMap((m) => m.collect()); }
}

// ----------------------------------------------------------------------------------------------------------------------------------
// The metrics this application emits. Fixed lists keep the series count bounded; see docs/monitoring.md for the table.
export const STATUS_CLASSES = ['2xx', '4xx', '5xx'] as const;
export const ROUTE_GROUPS = ['analytics', 'webhook', 'other'] as const;
export const JOBS = ['automation', 'outbox', 'webhook', 'scanner', 'billing', 'ai'] as const;
export const OUTCOMES = ['ok', 'failed', 'skipped'] as const;
export type Job = (typeof JOBS)[number];
export type Outcome = (typeof OUTCOMES)[number];

/** Gauges published by the once-a-minute snapshot tick. `billable` ones are declared to CloudWatch; the rest are log fields only. */
export const GAUGES: readonly { name: string; unit: Unit; billable: boolean }[] = [
  { name: 'OutboxOldestPendingSeconds', unit: 'Seconds', billable: true }, { name: 'OutboxFailed', unit: 'Count', billable: true }, { name: 'OutboxPending', unit: 'Count', billable: false },
  { name: 'RunsStuckRunning', unit: 'Count', billable: true }, { name: 'RunsQueuedOld', unit: 'Count', billable: true }, { name: 'RunsWaitingOverdue', unit: 'Count', billable: true }, { name: 'RunsFailedLastHour', unit: 'Count', billable: false },
  { name: 'BillingEventsNeedingAttention', unit: 'Count', billable: true }, { name: 'WebhookEventsUnprocessed', unit: 'Count', billable: true }, { name: 'OutboundMessagesFailedLastHour', unit: 'Count', billable: false },
  { name: 'WebhookDeliveriesOverdue', unit: 'Count', billable: false }, { name: 'WebhookDeliveriesFailedLastHour', unit: 'Count', billable: false }, { name: 'WebhookEndpointsDisabled', unit: 'Count', billable: false },
  { name: 'AiRunsLast15Min', unit: 'Count', billable: false }, { name: 'AiFailedLast15Min', unit: 'Count', billable: true }, { name: 'AiLatencyP95Ms24h', unit: 'Milliseconds', billable: true },
  { name: 'QueueRunsWaiting', unit: 'Count', billable: false }, { name: 'QueueRunsActive', unit: 'Count', billable: false }, { name: 'QueueRunsDelayed', unit: 'Count', billable: false }, { name: 'QueueRunsFailed', unit: 'Count', billable: true },
  { name: 'WorkersAlive', unit: 'Count', billable: true }, { name: 'WorkerHeartbeatAgeSeconds', unit: 'Seconds', billable: false },
];

export function routeGroup(route: string): (typeof ROUTE_GROUPS)[number] {
  if (route.startsWith('/analytics')) return 'analytics';
  if (route.startsWith('/webhooks')) return 'webhook';
  return 'other';
}
export function statusClass(status: number): (typeof STATUS_CLASSES)[number] { return status >= 500 ? '5xx' : status >= 400 ? '4xx' : '2xx'; }

/** Typed facade over a registry: the only way the rest of the code records a metric. */
export class AppMetrics {
  constructor(readonly registry: MetricsRegistry = new MetricsRegistry()) {
    registry.define({ name: 'RequestCount', kind: 'counter', unit: 'Count', dims: { StatusClass: STATUS_CLASSES }, billable: true });
    registry.define({ name: 'RequestDuration', kind: 'histogram', unit: 'Milliseconds', dims: { RouteGroup: ROUTE_GROUPS }, billable: true, buckets: DEFAULT_MS_BUCKETS, p95: true });
    registry.define({ name: 'JobFailures', kind: 'counter', unit: 'Count', dims: { Job: JOBS }, billable: true });
    registry.define({ name: 'JobOutcome', kind: 'counter', unit: 'Count', dims: { Job: JOBS, Outcome: OUTCOMES }, billable: false });
    registry.define({ name: 'ScannerTick', kind: 'histogram', unit: 'Milliseconds', billable: false, buckets: DEFAULT_MS_BUCKETS });
    registry.define({ name: 'AiRunLatency', kind: 'histogram', unit: 'Milliseconds', billable: false, buckets: DEFAULT_MS_BUCKETS });
    for (const g of GAUGES) registry.define({ name: g.name, kind: 'gauge', unit: g.unit, billable: g.billable });
  }

  http(status: number, route: string, durationMs: number): void {
    this.registry.get('RequestCount')?.inc({ StatusClass: statusClass(status) });
    this.registry.get('RequestDuration')?.observe(durationMs, { RouteGroup: routeGroup(route) });
  }
  job(job: Job, outcome: Outcome): void {
    this.registry.get('JobOutcome')?.inc({ Job: job, Outcome: outcome });
    if (outcome === 'failed') this.registry.get('JobFailures')?.inc({ Job: job });
  }
  scannerTick(ms: number, ok: boolean): void { this.registry.get('ScannerTick')?.observe(ms); this.job('scanner', ok ? 'ok' : 'failed'); }
  aiRun(outcome: Outcome, latencyMs: number): void { this.registry.get('AiRunLatency')?.observe(latencyMs); this.job('ai', outcome); }
  gauge(name: string, value: number | null | undefined): void {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    this.registry.get(name)?.set(value);
  }
  collect(): Sample[] { return this.registry.collect(); }
}

/** The process-wide instance used by the application code (tests can create their own AppMetrics). */
export const metrics = new AppMetrics();
