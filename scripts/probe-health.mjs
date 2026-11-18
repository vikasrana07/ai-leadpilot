// Dependency-free health probe for an external uptime check (see docs/runbooks/external-uptime-probe.md).
//   node scripts/probe-health.mjs https://api.example.com/health/ready --expect-ready
// Exit code 0 = healthy, 1 = unhealthy (non-2xx, timeout, network error, or a body that is not "ready"), 2 = bad usage.
// Prints exactly one line, so it can be used from cron, a monitoring agent or a CI job. It sends no credentials and reads no files.
//
// Options:
//   --expect-ready   the body must be JSON with status "ready" and db "up" (the shape of GET /health/ready). Redis "down" only prints a
//                    warning (the API treats Redis as degraded, not down) unless --strict-redis is given.
//   --strict-redis   with --expect-ready: also fail when redis is not "up".
//   --timeout <ms>   give up after this long (default 5000).
//   --quiet          print nothing on success.

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const url = args.find((a) => /^https?:\/\//i.test(a));
if (!url) {
  console.error('usage: node scripts/probe-health.mjs <http(s)://host/path> [--expect-ready] [--strict-redis] [--timeout <ms>] [--quiet]');
  process.exit(2);
}
const timeoutMs = Number(valueOf('--timeout', '5000'));
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) { console.error('--timeout must be a positive number of milliseconds'); process.exit(2); }

const started = Date.now();
const fail = (why) => { console.log(`FAIL ${why} (${Date.now() - started} ms) ${url}`); process.exit(1); };

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'leadpilot-probe/1' } });
  const text = await res.text();
  if (!res.ok) fail(`status ${res.status}`);
  let warning = '';
  if (flag('--expect-ready')) {
    let body;
    try { body = JSON.parse(text); } catch { fail('body is not JSON'); }
    if (body?.status !== 'ready') fail(`status field is "${String(body?.status)}", expected "ready"`);
    if (body?.db !== 'up') fail(`db is "${String(body?.db)}", expected "up"`);
    if (body?.redis !== 'up') {
      if (flag('--strict-redis')) fail(`redis is "${String(body?.redis)}", expected "up"`);
      warning = ` WARNING redis=${String(body?.redis)}`;
    }
  }
  if (!flag('--quiet') || warning) console.log(`OK ${res.status} (${Date.now() - started} ms) ${url}${warning}`);
  process.exit(0);
} catch (e) {
  const name = e instanceof Error ? e.name : '';
  fail(name === 'TimeoutError' || name === 'AbortError' ? `timeout after ${timeoutMs} ms` : `network error: ${e instanceof Error ? e.message : String(e)}`);
}
