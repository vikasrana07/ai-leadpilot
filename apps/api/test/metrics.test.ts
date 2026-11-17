import { describe, expect, it } from 'vitest';
import { EmfEmitter, formatEmf, type Scheduler } from '../src/observability/emf.js';
import { AppMetrics, estimatePercentile, GAUGES, MetricsRegistry, routeGroup, statusClass } from '../src/observability/metrics.js';

const T = new Date('2026-11-17T12:00:00.000Z');

describe('metrics registry', () => {
  it('counters are deltas: collect() reports activity once and resets', () => {
    const m = new AppMetrics();
    m.http(200, '/leads', 12); m.http(201, '/leads', 8); m.http(404, '/leads/:id', 3); m.http(500, '/analytics/summary', 900);
    const first = m.collect().filter((s) => s.def.name === 'RequestCount');
    const by = Object.fromEntries(first.map((s) => [s.labels.StatusClass, s.value]));
    expect(by).toEqual({ '2xx': 2, '4xx': 1, '5xx': 1 });
    expect(m.collect().filter((s) => s.def.name === 'RequestCount')).toEqual([]); // nothing new, nothing emitted
    m.http(200, '/leads', 5);
    expect(m.collect().find((s) => s.def.name === 'RequestCount')?.value).toBe(1);
  });

  it('gauges keep their last value across collects', () => {
    const m = new AppMetrics();
    m.gauge('OutboxFailed', 3);
    expect(m.collect().find((s) => s.def.name === 'OutboxFailed')?.value).toBe(3);
    expect(m.collect().find((s) => s.def.name === 'OutboxFailed')?.value).toBe(3);
    m.gauge('OutboxFailed', 0);
    expect(m.collect().find((s) => s.def.name === 'OutboxFailed')?.value).toBe(0);
    m.gauge('OutboxFailed', Number.NaN); m.gauge('OutboxFailed', null); // ignored
    expect(m.collect().find((s) => s.def.name === 'OutboxFailed')?.value).toBe(0);
  });

  it('histograms report count, sum, max and an estimated p95, then reset', () => {
    const m = new AppMetrics();
    for (let i = 1; i <= 100; i++) m.http(200, '/analytics/summary', i * 10); // 10..1000 ms
    const h = m.collect().find((s) => s.def.name === 'RequestDuration' && s.labels.RouteGroup === 'analytics');
    expect(h?.stats?.count).toBe(100);
    expect(h?.stats?.sum).toBe(50500);
    expect(h?.stats?.max).toBe(1000);
    expect(h?.stats?.p95).toBeGreaterThan(500); expect(h?.stats?.p95).toBeLessThanOrEqual(1000);
    expect(m.collect().find((s) => s.def.name === 'RequestDuration')).toBeUndefined();
  });

  it('percentile estimate handles empty, single bucket and the open top bucket', () => {
    expect(estimatePercentile([10, 100], [0, 0, 0], 0, 0.95, 0)).toBe(0);
    expect(estimatePercentile([10, 100], [5, 0, 0], 5, 0.95, 8)).toBeLessThanOrEqual(8);
    expect(estimatePercentile([10, 100], [0, 0, 4], 4, 0.95, 50000)).toBeGreaterThan(100); // above the last bound
  });

  it('cardinality guard: undeclared labels are dropped, unknown values collapse to "other", series are capped', () => {
    const r = new MetricsRegistry(4);
    const c = r.define({ name: 'X', kind: 'counter', unit: 'Count', dims: { Job: ['a', 'b'] }, billable: false });
    c.inc({ Job: '0f2d6b0e-aaaa-bbbb-cccc-123456789012' } as never); // an id-shaped value
    c.inc({ Job: 'a', Tenant: 'tenant-1', Path: '/leads/123' } as never); // extra keys ignored
    c.inc({ Job: 'zzz' });
    const out = c.collect();
    expect(out.map((s) => s.labels.Job).sort()).toEqual(['a', 'other']);
    expect(out.every((s) => Object.keys(s.labels).join() === 'Job')).toBe(true);
    // the cap is a backstop for metrics whose dimensions are all declared: here a 2-dim metric cannot exceed the product of allowed values
    const d = r.define({ name: 'Y', kind: 'counter', unit: 'Count', dims: { A: ['1', '2', '3'], B: ['x', 'y'] }, billable: false });
    for (const a of ['1', '2', '3', 'q']) for (const b of ['x', 'y', 'z']) d.inc({ A: a, B: b });
    expect(d.collect().length).toBe(4); // capped at 4 series
    expect(r.droppedSeries).toBeGreaterThan(0);
  });

  it('series count of the real metric set stays small and bounded', () => {
    const m = new AppMetrics();
    for (const s of [200, 404, 500, 302, 0]) for (const r of ['/analytics/x', '/webhooks/whatsapp/:key', '/leads', '', 'weird']) m.http(s, r, 5);
    for (const j of ['automation', 'outbox', 'webhook', 'scanner', 'billing', 'ai'] as const) for (const o of ['ok', 'failed', 'skipped'] as const) m.job(j, o);
    for (const g of GAUGES) m.gauge(g.name, 1);
    const samples = m.collect();
    const billable = samples.reduce((n, s) => n + (s.def.billable ? 1 + (s.stats?.p95 !== undefined ? 0 : 0) : 0), 0);
    expect(samples.length).toBeLessThan(80);
    expect(billable).toBeLessThanOrEqual(30); // documented in docs/monitoring.md
    expect(m.registry.droppedSeries).toBe(0);
  });

  it('classifies status and route', () => {
    expect([200, 301, 399, 400, 499, 500, 503].map(statusClass)).toEqual(['2xx', '2xx', '2xx', '4xx', '4xx', '5xx', '5xx']);
    expect(routeGroup('/analytics/summary')).toBe('analytics'); expect(routeGroup('/webhooks/whatsapp/:key')).toBe('webhook'); expect(routeGroup('/leads')).toBe('other'); expect(routeGroup('')).toBe('other');
  });
});

describe('CloudWatch EMF output', () => {
  it('follows the EMF spec: _aws.CloudWatchMetrics with Namespace, Dimensions, Metrics(Name, Unit), Timestamp, values as root fields', () => {
    const m = new AppMetrics();
    m.http(200, '/leads', 10); m.http(500, '/leads', 20); m.job('outbox', 'failed'); m.gauge('OutboxFailed', 2); m.gauge('OutboxPending', 7);
    const lines = formatEmf(m.collect(), { namespace: 'LeadPilot', service: 'api', now: T });
    const withMetrics = lines.filter((l) => l._aws);
    expect(withMetrics.length).toBeGreaterThan(0);
    for (const l of withMetrics) {
      const aws = l._aws as { Timestamp: number; CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[] };
      expect(aws.Timestamp).toBe(T.getTime());
      const d = aws.CloudWatchMetrics[0]!;
      expect(d.Namespace).toBe('LeadPilot');
      expect(d.Dimensions[0]).toContain('Service');
      expect(d.Metrics.length).toBeGreaterThan(0); expect(d.Metrics.length).toBeLessThanOrEqual(100);
      for (const mm of d.Metrics) { expect(typeof l[mm.Name]).toBe('number'); expect(['Count', 'Milliseconds', 'Seconds', 'None']).toContain(mm.Unit); }
      for (const dim of d.Dimensions[0]!) expect(typeof l[dim]).toBe('string'); // every dimension has a string value on the line
      expect(l.Service).toBe('api');
    }
    // gauges share one line (dimensions: Service only); a billable gauge is declared, a non-billable one is only a field
    const g = withMetrics.find((l) => 'OutboxFailed' in l)!;
    expect((g._aws as { CloudWatchMetrics: { Metrics: { Name: string }[] }[] }).CloudWatchMetrics[0]!.Metrics.map((x) => x.Name)).toContain('OutboxFailed');
    expect((g._aws as { CloudWatchMetrics: { Metrics: { Name: string }[] }[] }).CloudWatchMetrics[0]!.Metrics.map((x) => x.Name)).not.toContain('OutboxPending');
    expect(g.OutboxPending).toBe(7);
    // dimension sets: request counts carry StatusClass
    expect(withMetrics.some((l) => l.StatusClass === '5xx' && l.RequestCount === 1)).toBe(true);
    // histogram: Count/Sum/Max as fields, p95 declared
    const dur = lines.find((l) => 'RequestDurationCount' in l)!;
    expect(dur.RequestDurationCount).toBe(2); expect(dur.RequestDurationSumMs).toBe(30); expect(dur.RequestDurationMaxMs).toBe(20);
    expect((dur._aws as { CloudWatchMetrics: { Metrics: { Name: string; Unit: string }[] }[] }).CloudWatchMetrics[0]!.Metrics).toEqual([{ Name: 'RequestDurationP95Ms', Unit: 'Milliseconds' }]);
  });

  it('lines with no billable metric have no _aws block and are plain JSON fields with a timestamp', () => {
    const m = new AppMetrics(); m.job('outbox', 'ok');
    const lines = formatEmf(m.collect(), { namespace: 'LeadPilot', service: 'worker', now: T });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'metrics', Service: 'worker', Job: 'outbox', Outcome: 'ok', JobOutcome: 1, ts: T.toISOString() });
    expect(lines[0]!._aws).toBeUndefined();
  });

  it('never puts ids, tenants or paths on a line', () => {
    const m = new AppMetrics(); m.http(200, '/leads/0f2d6b0e-aaaa-bbbb-cccc-123456789012', 4);
    const text = JSON.stringify(formatEmf(m.collect(), { namespace: 'LeadPilot', service: 'api', now: T }));
    expect(text).not.toMatch(/0f2d6b0e|\/leads|tenant|user/i);
  });
});

describe('EMF emitter (fake clock)', () => {
  function rig(enabled: boolean) {
    const lines: string[] = []; let tick: (() => void) | null = null; let stopped = false; let now = T;
    const schedule: Scheduler = (fn) => { tick = fn; return { stop: () => { stopped = true; } }; };
    const m = new AppMetrics();
    const e = new EmfEmitter({ collect: () => m.collect(), service: 'api', intervalMs: 60_000, enabled, write: (l) => lines.push(l), now: () => now, schedule });
    return { m, e, lines, fire: () => { now = new Date(now.getTime() + 60_000); tick?.(); }, stopped: () => stopped };
  }
  it('writes one flush per interval, resets deltas, and flushes on stop', () => {
    const r = rig(true); r.e.start();
    r.m.http(200, '/leads', 5); r.fire();
    expect(r.lines.length).toBeGreaterThan(0);
    const n = r.lines.length;
    r.fire(); expect(r.lines.length).toBe(n); // no activity, no new request lines (gauges not set)
    r.m.http(500, '/leads', 7); r.e.stop();
    expect(r.stopped()).toBe(true); expect(r.lines.length).toBeGreaterThan(n); // final flush on shutdown
    for (const l of r.lines) { expect(l.endsWith('\n')).toBe(true); expect(() => JSON.parse(l)).not.toThrow(); }
  });
  it('does nothing when disabled', () => {
    const r = rig(false); r.e.start(); r.m.http(200, '/leads', 5); r.fire(); r.e.stop();
    expect(r.lines).toEqual([]);
  });
});
