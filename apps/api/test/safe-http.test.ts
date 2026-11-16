import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { isBlockedIp, resolvePublicTarget, safePost, UnsafeTargetError } from '../src/common/safe-http.js';

describe('SSRF blocklist (addresses)', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254', '169.254.0.1', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:192.168.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:a9fe:a9fe::', '::127.0.0.1', '2001:db8::1',
  ])('blocks %s', (ip) => { expect(isBlockedIp(ip)).toBe(true); });
  it.each(['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '193.0.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2001:4860:4860::8888'])('allows public %s', (ip) => { expect(isBlockedIp(ip)).toBe(false); });
  it('refuses anything that is not an IP', () => { expect(isBlockedIp('example.com')).toBe(true); expect(isBlockedIp('')).toBe(true); });
});

describe('SSRF blocklist (URLs, no network needed: IP literals and obfuscated forms)', () => {
  const bad = [
    'http://example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'https://user:pw@example.com/',
    'https://127.0.0.1/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/', 'https://0x7f.0.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/',
    'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.1/', 'https://172.16.5.5/', 'https://192.168.0.10/', 'https://localhost/', 'https://app.localhost/', 'https://metadata.google.internal/', 'https://0.0.0.0/', 'https://[fe80::1]/', 'https://[fd00::1]/',
  ];
  it.each(bad)('rejects %s', async (u) => { await expect(resolvePublicTarget(u)).rejects.toBeInstanceOf(UnsafeTargetError); });
  it('accepts a public IP literal over https and pins it', async () => {
    const t = await resolvePublicTarget('https://93.184.216.34/hook'); expect(t.address).toBe('93.184.216.34'); expect(t.family).toBe(4);
    expect((await resolvePublicTarget('https://[2606:4700:4700::1111]/hook')).family).toBe(6);
  });
});

describe('safePost behaviour (against a local receiver, private targets explicitly allowed for the test)', () => {
  const serve = (handler: http.RequestListener) => new Promise<{ url: string; close: () => void }>((res) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() })); });

  it('does not follow redirects (a redirect to a private address is just a 3xx failure) and reports status and latency', async () => {
    let hits = 0; const inner = await serve((_q, r) => { hits++; r.end('internal'); });
    const outer = await serve((_q, r) => { r.writeHead(302, { location: `${inner.url}/secret` }); r.end(); });
    const out = await safePost(await resolvePublicTarget(outer.url, { allowPrivate: true }), '{}', {}, { timeoutMs: 2000 });
    expect(out.status).toBe(302); expect(hits).toBe(0); expect(out.latencyMs).toBeGreaterThanOrEqual(0);
    inner.close(); outer.close();
  });
  it('enforces a timeout and caps how much of the response is kept', async () => {
    const slow = await serve(() => { /* never answers */ });
    await expect(safePost(await resolvePublicTarget(slow.url, { allowPrivate: true }), '{}', {}, { timeoutMs: 300 })).rejects.toThrow();
    slow.close();
    const big = await serve((_q, r) => { r.end('x'.repeat(100_000)); });
    const res = await safePost(await resolvePublicTarget(big.url, { allowPrivate: true }), '{}', {}, { timeoutMs: 2000 });
    expect(res.bodySnippet.length).toBeLessThanOrEqual(300); big.close();
  });
  it('connects to the pinned address even if the name would resolve elsewhere (rebinding)', async () => {
    const s = await serve((_q, r) => r.end('ok'));
    const t = await resolvePublicTarget(s.url, { allowPrivate: true });
    const rebind = { ...t, url: new URL(`http://rebind.invalid:${new URL(s.url).port}/`) }; // the name does not resolve; only the pinned address can work
    expect((await safePost(rebind, '{}', {}, { timeoutMs: 2000 })).status).toBe(200);
    s.close();
  });
});
