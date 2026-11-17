import type { Sample, Unit } from './metrics.js';

/**
 * CloudWatch Embedded Metric Format (EMF): one JSON object per line on stdout. CloudWatch Logs turns the metrics declared in `_aws`
 * into custom metrics; everything else on the line stays a searchable log field (free to query with Logs Insights).
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 *
 * Series that share the same dimension values are written on one line (about a dozen lines a minute, not one per metric).
 * Counters and histograms are deltas for the interval; histograms are written as Count/Sum/Max fields plus, when asked, an
 * estimated p95 metric. Only `billable` metrics are declared to CloudWatch; the others are plain fields.
 */
export interface EmfOptions { namespace: string; service: string; now: Date }

const UNIT_SUFFIX: Record<Unit, string> = { Count: '', Milliseconds: 'Ms', Seconds: 'Seconds', None: '' };
const CW_UNIT: Record<Unit, string> = { Count: 'Count', Milliseconds: 'Milliseconds', Seconds: 'Seconds', None: 'None' };

interface Emitted { name: string; unit: Unit; value: number; billable: boolean }

function expand(s: Sample): Emitted[] {
  const { def } = s;
  if (s.value !== undefined) return [{ name: def.name, unit: def.unit, value: s.value, billable: def.billable }];
  const st = s.stats;
  if (!st) return [];
  const sfx = UNIT_SUFFIX[def.unit];
  const out: Emitted[] = [
    { name: `${def.name}Count`, unit: 'Count', value: st.count, billable: false },
    { name: `${def.name}Sum${sfx}`, unit: def.unit, value: Math.round(st.sum * 10) / 10, billable: false },
    { name: `${def.name}Max${sfx}`, unit: def.unit, value: st.max, billable: false },
  ];
  if (st.p95 !== undefined) out.push({ name: `${def.name}P95${sfx}`, unit: def.unit, value: st.p95, billable: def.billable });
  return out;
}

export function formatEmf(samples: readonly Sample[], opts: EmfOptions): Record<string, unknown>[] {
  const groups = new Map<string, { dims: Record<string, string>; metrics: Emitted[] }>();
  for (const s of samples) {
    const dims = { Service: opts.service, ...s.labels };
    const key = JSON.stringify(Object.entries(dims).sort(([a], [b]) => a.localeCompare(b)));
    const g = groups.get(key) ?? { dims, metrics: [] as Emitted[] };
    g.metrics.push(...expand(s));
    groups.set(key, g);
  }
  const lines: Record<string, unknown>[] = [];
  for (const g of groups.values()) {
    const billable = g.metrics.filter((m) => m.billable);
    const line: Record<string, unknown> = { msg: 'metrics', ...g.dims };
    for (const m of g.metrics) line[m.name] = m.value;
    if (billable.length > 0) {
      line._aws = {
        Timestamp: opts.now.getTime(),
        CloudWatchMetrics: [{ Namespace: opts.namespace, Dimensions: [Object.keys(g.dims)], Metrics: billable.map((m) => ({ Name: m.name, Unit: CW_UNIT[m.unit] })) }],
      };
    } else line.ts = opts.now.toISOString();
    lines.push(line);
  }
  return lines;
}

export interface Scheduler { (fn: () => void, ms: number): { stop(): void } }
const realScheduler: Scheduler = (fn, ms) => { const t = setInterval(fn, ms); t.unref(); return { stop: () => clearInterval(t) }; };

export interface EmitterOptions {
  collect: () => Sample[]; namespace?: string; service: string; intervalMs: number; enabled: boolean;
  write?: (line: string) => void; now?: () => Date; schedule?: Scheduler;
}

/** Flushes the registry as EMF lines every interval and once more on shutdown. Does nothing when disabled. */
export class EmfEmitter {
  private timer: { stop(): void } | null = null;
  constructor(private readonly o: EmitterOptions) {}

  start(): void {
    if (!this.o.enabled || this.timer) return;
    this.timer = (this.o.schedule ?? realScheduler)(() => this.flush(), this.o.intervalMs);
  }
  flush(): number {
    if (!this.o.enabled) return 0;
    const lines = formatEmf(this.o.collect(), { namespace: this.o.namespace ?? 'LeadPilot', service: this.o.service, now: (this.o.now ?? (() => new Date()))() });
    const write = this.o.write ?? ((l: string) => { process.stdout.write(l); });
    for (const l of lines) write(`${JSON.stringify(l)}\n`);
    return lines.length;
  }
  stop(): void { this.timer?.stop(); this.timer = null; this.flush(); }
}
