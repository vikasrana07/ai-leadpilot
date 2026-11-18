import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../../scripts/probe-health.mjs');
let server: Server; let base = '';
const routes: Record<string, { status: number; body: string; delayMs?: number }> = {
  '/ok': { status: 200, body: '{"status":"ok"}' },
  '/ready': { status: 200, body: '{"status":"ready","db":"up","redis":"up"}' },
  '/ready-redis-down': { status: 200, body: '{"status":"ready","db":"up","redis":"down"}' },
  '/db-down': { status: 503, body: '{"error":{"code":"db_unavailable"}}' },
  '/ready-but-db-down': { status: 200, body: '{"status":"ready","db":"down","redis":"up"}' },
  '/not-json': { status: 200, body: '<html>hello</html>' },
  '/slow': { status: 200, body: '{"status":"ready","db":"up"}', delayMs: 2000 },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const r = routes[req.url ?? ''];
    if (!r) { res.statusCode = 404; res.end('no'); return; }
    setTimeout(() => { res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(r.body); }, r.delayMs ?? 0);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise((ok) => server.close(ok)); });

function probe(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); }); p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('close', (code) => done({ code: code ?? -1, out: out.trim(), err: err.trim() }));
  });
}

describe('scripts/probe-health.mjs', () => {
  it('exits 0 and prints one OK line for a 2xx response', async () => {
    const r = await probe([`${base}/ok`]);
    expect(r.code).toBe(0); expect(r.out).toMatch(/^OK 200 \(\d+ ms\) http/); expect(r.out.split('\n')).toHaveLength(1);
  });
  it('--quiet prints nothing on success', async () => { const r = await probe([`${base}/ok`, '--quiet']); expect(r).toMatchObject({ code: 0, out: '' }); });
  it('exits 1 on a non-2xx status', async () => {
    const r = await probe([`${base}/db-down`]); expect(r.code).toBe(1); expect(r.out).toMatch(/^FAIL status 503/);
    expect((await probe([`${base}/missing`])).code).toBe(1);
  });
  it('--expect-ready accepts a ready body and rejects wrong or non-JSON bodies', async () => {
    expect((await probe([`${base}/ready`, '--expect-ready'])).code).toBe(0);
    const a = await probe([`${base}/ok`, '--expect-ready']); expect(a.code).toBe(1); expect(a.out).toMatch(/expected "ready"/);
    const b = await probe([`${base}/ready-but-db-down`, '--expect-ready']); expect(b.code).toBe(1); expect(b.out).toMatch(/db is "down"/);
    const c = await probe([`${base}/not-json`, '--expect-ready']); expect(c.code).toBe(1); expect(c.out).toMatch(/not JSON/);
  });
  it('redis down is a warning unless --strict-redis', async () => {
    const warn = await probe([`${base}/ready-redis-down`, '--expect-ready', '--quiet']);
    expect(warn.code).toBe(0); expect(warn.out).toMatch(/WARNING redis=down/);
    const strict = await probe([`${base}/ready-redis-down`, '--expect-ready', '--strict-redis']);
    expect(strict.code).toBe(1); expect(strict.out).toMatch(/redis is "down"/);
  });
  it('gives up after --timeout and fails', async () => {
    const r = await probe([`${base}/slow`, '--timeout', '300']); expect(r.code).toBe(1); expect(r.out).toMatch(/timeout after 300 ms/);
  });
  it('fails when nothing is listening and rejects bad usage with exit code 2', async () => {
    const dead = await probe(['http://127.0.0.1:1/health/ready', '--timeout', '2000']); expect(dead.code).toBe(1); expect(dead.out).toMatch(/^FAIL (network error|timeout)/);
    expect((await probe([])).code).toBe(2);
    expect((await probe([`${base}/ok`, '--timeout', 'abc'])).code).toBe(2);
  });
});
