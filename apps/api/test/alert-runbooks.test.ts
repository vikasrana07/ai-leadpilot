import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALERT_RULES } from '../src/ops/alert-rules.js';

const ROOT = resolve(__dirname, '../../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

describe('alert rules and runbooks stay consistent', () => {
  it('rule keys are unique and every rule has a title, hint and runbook path under docs/runbooks', () => {
    const keys = ALERT_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of ALERT_RULES) {
      expect(r.title.length, r.key).toBeGreaterThan(5); expect(r.hint.length, r.key).toBeGreaterThan(20);
      expect(r.runbook, r.key).toMatch(/^docs\/runbooks\/[a-z-]+\.md$/);
    }
  });

  it.each(ALERT_RULES.map((r) => [r.key, r.runbook] as const))('%s: its runbook (%s) exists and names the rule in its "Alerts that point here" line', (key, runbook) => {
    const abs = resolve(ROOT, runbook);
    expect(existsSync(abs), `${runbook} does not exist`).toBe(true);
    const head = read(runbook).split('\n').slice(0, 12);
    const line = head.find((l) => /alerts? that points? here/i.test(l));
    expect(line, `${runbook} has no "Alerts that point here" line in its first 12 lines`).toBeTruthy();
    expect(line, `${runbook} does not name \`${key}\``).toContain(`\`${key}\``);
  });

  it('docs/monitoring.md maps every rule key to its runbook file, and docs/slos-and-alerts.md lists every rule key', () => {
    const monitoring = read('docs/monitoring.md');
    const start = monitoring.indexOf('## Alert-to-runbook map');
    expect(start, 'docs/monitoring.md has no "Alert-to-runbook map" section').toBeGreaterThan(-1);
    const map = monitoring.slice(start);
    const slos = read('docs/slos-and-alerts.md');
    for (const r of ALERT_RULES) {
      const row = map.split('\n').find((l) => l.startsWith(`| \`${r.key}\` |`));
      expect(row, `monitoring.md map has no row for ${r.key}`).toBeTruthy();
      expect(row, `${r.key}: row does not mention ${basename(r.runbook)}`).toContain(basename(r.runbook));
      expect(slos, `slos-and-alerts.md does not list ${r.key}`).toContain(`\`${r.key}\``);
    }
  });

  it('the runbook index lists the external uptime probe and every runbook file named by a rule', () => {
    const index = read('docs/runbooks/README.md');
    expect(index).toContain('external-uptime-probe.md');
    for (const r of ALERT_RULES) expect(index, basename(r.runbook)).toContain(basename(r.runbook));
  });
});
