// Boots the BUILT server under plain Node and probes it. Guards against tooling-specific DI breakage
// (the unit/integration tests run under Vitest, which loads modules differently from production Node).
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, API_PORT: '4099' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const fail = (msg) => { child.kill(); console.error(`SMOKE FAILED: ${msg}\n${out.slice(-2000)}`); process.exit(1); };

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch('http://localhost:4099/health/ready');
    if (res.ok) {
      const unauth = await fetch('http://localhost:4099/tenant');
      if (unauth.status !== 401) fail(`expected 401 on /tenant, got ${unauth.status}`);
      child.kill();
      console.log('SMOKE OK');
      process.exit(0);
    }
  } catch { /* not up yet */ }
}
fail('server did not become ready in 20s');
