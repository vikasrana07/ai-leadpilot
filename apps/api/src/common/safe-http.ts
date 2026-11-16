import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class UnsafeTargetError extends Error {}

function ipv4ToInt(ip: string): number { return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0; }
const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => { const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; return (n & mask) === (ipv4ToInt(base) & mask); });
}

/** Expands any IPv6 text form to 8 hextets (numbers). Returns null if it is not a valid IPv6 address. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0] ?? '';
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const o = (m[1] as string).split('.').map(Number); s = s.slice(0, -(m[1] as string).length) + ((o[0] as number) * 256 + (o[1] as number)).toString(16) + ':' + ((o[2] as number) * 256 + (o[3] as number)).toString(16); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : []; const tail = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill('0'), ...tail].map((h) => parseInt(h || '0', 16));
  return all.length === 8 && all.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? all : null;
}
const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address that must never be a webhook target: loopback, private, link-local (incl. cloud metadata), CGNAT, multicast, reserved, and IPv6 forms that embed those. */
export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return v4Blocked(ip);
  if (v !== 6) return true; // not an IP at all: refuse
  const h = expandV6(ip);
  if (!h) return true;
  const [a, b, , , , f, g, hh] = h as [number, number, number, number, number, number, number, number];
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  if (h.slice(0, 5).every((x) => x === 0) && f === 0xffff) return v4Blocked(embeddedV4(g, hh)); // ::ffff:a.b.c.d (IPv4-mapped)
  if (h.slice(0, 6).every((x) => x === 0)) return v4Blocked(embeddedV4(g, hh)); // ::a.b.c.d (deprecated IPv4-compatible)
  if (a === 0x64 && b === 0xff9b) return v4Blocked(embeddedV4(g, hh)); // 64:ff9b::/96 NAT64
  if (a === 0x2002) return v4Blocked(embeddedV4(b, h[2] as number)); // 6to4 2002:AABB:CCDD::
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x100 && b === 0) return true; // discard prefix
  return false;
}

export interface ResolvedTarget { url: URL; address: string; family: 4 | 6 }

/**
 * Validates a webhook URL and resolves it ONCE to a public address. Callers connect to that exact address (see `safePost`), so a DNS answer
 * cannot change between the check and the connection (DNS rebinding). Every address a name resolves to must be public.
 */
export async function resolvePublicTarget(rawUrl: string, opts: { allowPrivate?: boolean } = {}): Promise<ResolvedTarget> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UnsafeTargetError('The URL is not valid'); }
  if (url.protocol !== 'https:' && !(opts.allowPrivate && url.protocol === 'http:')) throw new UnsafeTargetError('Only https:// URLs are allowed');
  if (url.username || url.password) throw new UnsafeTargetError('URLs with embedded credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) { if (!opts.allowPrivate) throw new UnsafeTargetError('That host is not allowed'); }
  const literal = net.isIP(host) ? [{ address: host, family: net.isIP(host) as 4 | 6 }] : null;
  let addrs: { address: string; family: number }[];
  if (literal) addrs = literal;
  else { try { addrs = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new UnsafeTargetError('The host name could not be resolved'); } }
  if (addrs.length === 0) throw new UnsafeTargetError('The host name could not be resolved');
  if (!opts.allowPrivate && addrs.some((a) => isBlockedIp(a.address))) throw new UnsafeTargetError('That address is not allowed (private, loopback or link-local network)');
  const first = addrs[0] as { address: string; family: number };
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

export interface PostResult { status: number; latencyMs: number; bodySnippet: string }

/**
 * POSTs to a validated target: connects to the pinned address (TLS SNI and Host still use the original name), never follows redirects,
 * enforces a total timeout and a response size cap, and reads at most a short snippet of the answer.
 */
export function safePost(target: ResolvedTarget, body: string, headers: Record<string, string>, opts: { timeoutMs: number; maxResponseBytes?: number }): Promise<PostResult> {
  const started = Date.now();
  const max = opts.maxResponseBytes ?? 4096;
  const lib = target.url.protocol === 'https:' ? https : http;
  return new Promise<PostResult>((resolve, reject) => {
    const req = lib.request({
      protocol: target.url.protocol, hostname: target.url.hostname.replace(/^\[|\]$/g, ''), port: target.url.port || (target.url.protocol === 'https:' ? 443 : 80), path: `${target.url.pathname}${target.url.search}`, method: 'POST',
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) }, servername: net.isIP(target.url.hostname.replace(/^\[|\]$/g, '')) ? undefined : target.url.hostname, timeout: opts.timeoutMs,
      // Always answer with the pinned address (Node may ask for all addresses, hence the two shapes).
      lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => (o?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family))) as never,
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size <= max) chunks.push(c); if (size > max * 16) { res.destroy(); } });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, latencyMs: Date.now() - started, bodySnippet: Buffer.concat(chunks).toString('utf8').slice(0, 300) }));
      res.on('error', reject);
    });
    const deadline = setTimeout(() => req.destroy(new Error('timeout')), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => { clearTimeout(deadline); reject(e); });
    req.on('close', () => clearTimeout(deadline));
    req.end(body);
  });
}
