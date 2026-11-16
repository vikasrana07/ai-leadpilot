import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parseCsv } from '../../common/csv.js';

export type DocKind = 'pdf' | 'docx' | 'txt' | 'csv';
export const MAX_TEXT_CHARS = 2_000_000;

export const ALLOWED: Record<DocKind, { ext: string[]; mimes: string[] }> = {
  pdf: { ext: ['pdf'], mimes: ['application/pdf'] },
  docx: { ext: ['docx'], mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  txt: { ext: ['txt', 'md'], mimes: ['text/plain', 'text/markdown'] },
  csv: { ext: ['csv'], mimes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'] },
};

/** Decides the document kind from the extension AND the actual bytes: a renamed executable is rejected. */
export function detectKind(filename: string, declaredMime: string, data: Buffer): DocKind | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const kind = (Object.keys(ALLOWED) as DocKind[]).find((k) => ALLOWED[k].ext.includes(ext));
  if (!kind || !ALLOWED[kind].mimes.includes(declaredMime.split(';')[0]?.trim().toLowerCase() ?? '')) return null;
  if (kind === 'pdf') return data.subarray(0, 5).toString('latin1') === '%PDF-' ? 'pdf' : null;
  if (kind === 'docx') return data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04 ? 'docx' : null; // ZIP container
  // text-like: no NUL bytes in the first 8 KB, and not a known binary magic number
  const head = data.subarray(0, 8192);
  if (head.includes(0)) return null;
  if (head.subarray(0, 2).toString('latin1') === 'MZ' || head.subarray(0, 4).toString('latin1') === '\x7fELF') return null;
  return kind;
}

/**
 * PDF and DOCX parsing runs in a throw-away worker thread, never in the API process:
 *  - parsers handle untrusted files, so a crash, hang or memory blow-up must not take the API down (limits + timeout below);
 *  - pdf.js patches built-in prototypes (e.g. Uint8Array base64 helpers), which silently broke JWT verification in the main
 *    realm. A worker has its own realm, so that pollution cannot reach the API.
 */
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    let text;
    if (workerData.kind === 'pdf') {
      const { extractText, getDocumentProxy } = await import(workerData.unpdf);
      const pdf = await getDocumentProxy(new Uint8Array(workerData.data));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else {
      const m = require(workerData.mammoth);
      text = (await m.extractRawText({ buffer: Buffer.from(workerData.data) })).value;
    }
    parentPort.postMessage({ ok: true, text: String(text) });
  } catch (e) { parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) }); }
})();`;

function extractInWorker(kind: 'pdf' | 'docx', data: Buffer, timeoutMs = 30_000): Promise<string> {
  const req = createRequire(import.meta.url);
  const unpdf = pathToFileURL(req.resolve('unpdf')).href;
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { kind, data: new Uint8Array(data), unpdf, mammoth: req.resolve('mammoth') }, resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64 } });
    const timer = setTimeout(() => { void w.terminate(); reject(new Error('Document parsing timed out')); }, timeoutMs);
    w.once('message', (m: { ok: boolean; text?: string; error?: string }) => { clearTimeout(timer); void w.terminate(); if (m.ok) resolve(m.text ?? ''); else reject(new Error(m.error ?? 'Parsing failed')); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
    w.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`Parser exited with code ${code}`)); });
  });
}

export async function extractText(kind: DocKind, data: Buffer): Promise<string> {
  let text: string;
  if (kind === 'pdf' || kind === 'docx') text = await extractInWorker(kind, data);
  else if (kind === 'csv') {
    const rows = parseCsv(data.toString('utf8'));
    const header = rows[0] ?? [];
    text = rows.slice(1).map((r) => r.map((c, i) => `${(header[i] ?? `col${i + 1}`).trim()}: ${c.trim()}`).filter((x) => !x.endsWith(': ')).join('; ')).join('\n');
  } else text = data.toString('utf8').replace(/^\uFEFF/, '');
  // eslint-disable-next-line no-control-regex -- stripping control characters from untrusted extracted text is the point
  text = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.slice(0, MAX_TEXT_CHARS);
}

/** Paragraph-aware chunks of roughly `size` characters with `overlap` carried into the next chunk. */
export function chunkText(text: string, size = 900, overlap = 120): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  const flush = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const p of paras) {
    if (p.length > size) {
      flush();
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size).trim());
      continue;
    }
    if (cur && cur.length + p.length + 2 > size) { const tail = cur.slice(-overlap); flush(); cur = `${tail}\n\n`; }
    cur += (cur.trim() ? '\n\n' : '') + p;
  }
  flush();
  return chunks.filter((c) => c.length > 0);
}

const INJECTION = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|prompts?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|system)\s+(instructions|rules|prompt)/i,
  /(reveal|show|print|repeat|output)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions)/i,
  /you\s+are\s+now\s+(in\s+)?(dan|admin|developer|jailbreak|unrestricted)/i,
  /\b(system|developer)\s*:\s*(you|ignore|from now)/i,
  /(tell|inform)\s+(every|all|each)\s+customers?\b.{0,60}\b(free|discount|refund)/i,
];

/**
 * Documents are reference data, never instructions. Sentences that look like commands aimed at an AI ("ignore all previous
 * instructions", "reveal your prompt"…) are removed before indexing, so they can never be retrieved and echoed to customers.
 * Defence in depth: retrieved text is also delimited and labelled as data in the prompt.
 */
export function stripInjection(text: string): { text: string; removed: number } {
  let removed = 0;
  const kept = text.split(/(?<=[.!?\n])\s+/).filter((sentence) => { if (INJECTION.some((re) => re.test(sentence))) { removed++; return false; } return true; });
  return { text: kept.join(' ').replace(/[ \t]{2,}/g, ' '), removed };
}
