/** Output guards: the last line of defence against invented prices, unknown contact details and prompt leakage. */

const UNIT: Record<string, number> = { cr: 1e7, crore: 1e7, crores: 1e7, l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, k: 1e3 };

/** Money amounts mentioned in text, normalised to rupees. Recognises ₹/Rs/INR amounts and "1.2 Cr" / "85 lakh" forms. */
export function extractAmounts(text: string): number[] {
  const out: { at: number; value: number }[] = [];
  const spans: [number, number][] = [];
  const withSymbol = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|l|k)?\b/gi;
  const withUnit = /(?<![\d.])(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?)\b/gi;
  for (const m of text.matchAll(withSymbol)) { const i = m.index ?? 0; spans.push([i, i + m[0].length]); out.push({ at: i, value: Number((m[1] as string).replace(/,/g, '')) * (UNIT[(m[2] ?? '').toLowerCase()] ?? 1) }); }
  for (const m of text.matchAll(withUnit)) { const i = m.index ?? 0; if (spans.some(([a, b]) => i >= a && i < b)) continue; out.push({ at: i, value: Number(m[1]) * (UNIT[(m[2] as string).toLowerCase()] ?? 1) }); }
  return out.sort((x, y) => x.at - y.at).map((o) => o.value).filter((n) => Number.isFinite(n) && n > 0);
}

const numbersIn = (text: string): number[] => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n >= 1000);
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01);

/** Clock times in text, normalised to 24h HH:MM ("4 pm" -> 16:00). */
export function timesIn(text: string): Set<string> {
  const out = new Set<string>();
  const pad = (n: number) => String(n).padStart(2, '0');
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\b\.?/gi)) {
    let h = Number(m[1]); if (h < 1 || h > 12) continue;
    const pm = (m[3] as string).toLowerCase() === 'p'; if (h === 12) h = 0; if (pm) h += 12;
    out.add(`${pad(h)}:${m[2] ?? '00'}`);
  }
  for (const m of text.matchAll(/(?<![\d:.\w])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g)) out.add(`${pad(Number(m[1]))}:${m[2]}`);
  return out;
}

export interface GuardInput { reply: string; facts: string; canary: string; maxChars: number }
export interface GuardResult { ok: boolean; violations: string[]; reply: string }

/** Cuts at the last sentence end before the limit (or hard-cuts) so replies stay short without breaking mid-word. */
export function truncateReply(reply: string, maxChars: number): string {
  if (reply.length <= maxChars) return reply;
  const cut = reply.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('.\n'));
  return (end > maxChars * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`).trim();
}

export function checkReply({ reply, facts, canary, maxChars }: GuardInput): GuardResult {
  const violations: string[] = [];
  const text = truncateReply(reply.trim(), maxChars);
  if (!text) violations.push('empty_reply');
  if (text.includes(canary)) violations.push('prompt_leak');

  const known = [...extractAmounts(facts), ...numbersIn(facts)];
  for (const amt of extractAmounts(text)) if (!known.some((k) => near(k, amt))) { violations.push(`unsupported_amount:${Math.round(amt)}`); break; }

  const factsLower = facts.toLowerCase();
  for (const url of text.match(/https?:\/\/[^\s)>"']+/gi) ?? []) if (!factsLower.includes(url.toLowerCase().replace(/[.,;]+$/, ''))) { violations.push('unsupported_url'); break; }
  const factDigits = facts.replace(/\D/g, '');
  for (const ph of text.match(/(?:\+?\d[\d\s-]{8,}\d)/g) ?? []) { const d = ph.replace(/\D/g, ''); if (d.length >= 10 && !factDigits.includes(d.slice(-10))) { violations.push('unsupported_phone'); break; } }
  const knownTimes = timesIn(facts);
  for (const t of timesIn(text)) if (!knownTimes.has(t)) { violations.push(`unsupported_time:${t}`); break; }
  return { ok: violations.length === 0, violations, reply: text };
}
